const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const { Server } = require('socket.io');
const { saveGameState, loadGameState, GAME_STATE_FILE, BACKUP_DIRECTORY } = require('./storage');

const PORT = 3000;
const PLAYER_NAMES = ['Czerwony', 'Niebieski', 'Żółty', 'Zielony'];
const ADMIN_PLAYER_INDEX = 0;
const MAX_ADDITIONAL_TURNS_PER_PLAYER = 3;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

function createInitialGameState() {
  return {
    status: 'waiting',
    active_player_index: 0,
    turn_started_at: null,
    player_times_ms: [0, 0, 0, 0],
    player_turn_counts: [0, 0, 0, 0],
    player_additional_turns_used: [0, 0, 0, 0],
    player_turn_order: [0, 1, 2, 3],
    connected_players: {}
  };
}

let game_state = loadGameState(createInitialGameState);
const socket_to_player = new Map();

function getLocalNetworkAddresses() {
  const addresses = [];
  const network_interfaces = os.networkInterfaces();

  for (const interface_name of Object.keys(network_interfaces)) {
    for (const network_address of network_interfaces[interface_name]) {
      if (network_address.family === 'IPv4' && !network_address.internal) {
        addresses.push(network_address.address);
      }
    }
  }

  return addresses;
}

function getElapsedActiveTime() {
  if (game_state.status !== 'running' || game_state.turn_started_at === null) {
    return 0;
  }

  return Date.now() - game_state.turn_started_at;
}

function applyActivePlayerElapsedTime() {
  if (game_state.status !== 'running' || game_state.turn_started_at === null) {
    return;
  }

  const elapsed_time = getElapsedActiveTime();
  const active_index = game_state.active_player_index;
  game_state.player_times_ms[active_index] += elapsed_time;
}

function getPublicGameState() {
  return {
    status: game_state.status,
    active_player_index: game_state.active_player_index,
    turn_started_at: game_state.turn_started_at,
    player_times_ms: [...game_state.player_times_ms],
    player_turn_counts: [...game_state.player_turn_counts],
    player_additional_turns_used: [...game_state.player_additional_turns_used],
    player_turn_order: [...game_state.player_turn_order],
    connected_players: { ...game_state.connected_players }
  };
}

function broadcastGameState() {
  saveGameState(game_state);
  io.emit('game_state', getPublicGameState());
}

function releasePlayerSlot(socket_id) {
  const player_index = socket_to_player.get(socket_id);

  if (player_index === undefined) {
    return;
  }

  delete game_state.connected_players[player_index];
  socket_to_player.delete(socket_id);
}

function validatePlayerIndex(player_index) {
  return Number.isInteger(player_index) && player_index >= 0 && player_index <= 3;
}

function isAdmin(player_index) {
  return player_index === ADMIN_PLAYER_INDEX;
}

function getPlayerIndexFromSocket(socket) {
  return socket_to_player.get(socket.id);
}

function rejectUnlessAdmin(socket, callback) {
  const player_index = getPlayerIndexFromSocket(socket);

  if (!isAdmin(player_index)) {
    callback?.({ success: false, message: 'Tylko Czerwony może to zrobić.' });
    return false;
  }

  return true;
}

function advanceToNextPlayer() {
  const turn_order = game_state.player_turn_order;
  const current_order_position = turn_order.indexOf(game_state.active_player_index);
  const next_order_position = (current_order_position + 1) % 4;
  game_state.active_player_index = turn_order[next_order_position];
  game_state.player_turn_counts[game_state.active_player_index] += 1;
  game_state.turn_started_at = Date.now();
}

io.on('connection', (socket) => {
  socket.emit('game_state', getPublicGameState());

  socket.on('join', (player_index, callback) => {
    if (!validatePlayerIndex(player_index)) {
      callback?.({ success: false, message: 'Nieprawidłowy numer gracza.' });
      return;
    }

    const existing_socket_id = game_state.connected_players[player_index];

    if (existing_socket_id && existing_socket_id !== socket.id) {
      callback?.({
        success: false,
        message: `${PLAYER_NAMES[player_index]} jest już połączony.`
      });
      return;
    }

    releasePlayerSlot(socket.id);
    socket_to_player.set(socket.id, player_index);
    game_state.connected_players[player_index] = socket.id;

    callback?.({ success: true });
    broadcastGameState();
  });

  socket.on('move_player_in_turn_order', (move_data, callback) => {
    if (!rejectUnlessAdmin(socket, callback)) {
      return;
    }

    if (game_state.status !== 'waiting') {
      callback?.({ success: false, message: 'Nie można zmieniać kolejności po rozpoczęciu gry.' });
      return;
    }

    const order_position = Number(move_data?.order_position);
    const direction = move_data?.direction;

    if (!Number.isInteger(order_position) || order_position < 0 || order_position > 3) {
      callback?.({ success: false, message: 'Nieprawidłowa pozycja w kolejności.' });
      return;
    }

    if (direction !== 'up' && direction !== 'down') {
      callback?.({ success: false, message: 'Nieprawidłowy kierunek przesunięcia.' });
      return;
    }

    const swap_position = direction === 'up' ? order_position - 1 : order_position + 1;

    if (swap_position < 0 || swap_position > 3) {
      callback?.({ success: false, message: 'Nie można przesunąć dalej.' });
      return;
    }

    const turn_order = game_state.player_turn_order;
    const player_at_position = turn_order[order_position];
    turn_order[order_position] = turn_order[swap_position];
    turn_order[swap_position] = player_at_position;

    callback?.({ success: true });
    broadcastGameState();
  });

  socket.on('start_game', (callback) => {
    if (!rejectUnlessAdmin(socket, callback)) {
      return;
    }

    if (game_state.status !== 'waiting') {
      callback?.({ success: false, message: 'Gra została już rozpoczęta.' });
      return;
    }

    game_state.status = 'running';
    game_state.active_player_index = game_state.player_turn_order[0];
    game_state.player_turn_counts[game_state.active_player_index] += 1;
    game_state.turn_started_at = Date.now();

    callback?.({ success: true });
    broadcastGameState();
  });

  socket.on('end_turn', (callback) => {
    if (game_state.status !== 'running') {
      callback?.({ success: false, message: 'Gra nie jest w toku.' });
      return;
    }

    const player_index = getPlayerIndexFromSocket(socket);
    const player_is_admin = isAdmin(player_index);
    const player_is_active = player_index === game_state.active_player_index;

    if (!player_is_admin && !player_is_active) {
      callback?.({ success: false, message: 'Tylko aktywny gracz może zakończyć turę.' });
      return;
    }

    applyActivePlayerElapsedTime();
    advanceToNextPlayer();

    callback?.({ success: true });
    broadcastGameState();
  });

  socket.on('additional_turn', (callback) => {
    if (game_state.status !== 'running') {
      callback?.({ success: false, message: 'Gra nie jest w toku.' });
      return;
    }

    const player_index = getPlayerIndexFromSocket(socket);
    const player_is_admin = isAdmin(player_index);
    const player_is_active = player_index === game_state.active_player_index;

    if (!player_is_admin && !player_is_active) {
      callback?.({ success: false, message: 'Tylko aktywny gracz może dodać turę.' });
      return;
    }

    const active_player_index = game_state.active_player_index;

    if (
      game_state.player_additional_turns_used[active_player_index] >=
      MAX_ADDITIONAL_TURNS_PER_PLAYER
    ) {
      callback?.({
        success: false,
        message: `${PLAYER_NAMES[active_player_index]} nie ma już dodatkowych tur.`
      });
      return;
    }

    game_state.player_turn_counts[active_player_index] += 1;
    game_state.player_additional_turns_used[active_player_index] += 1;

    callback?.({ success: true });
    broadcastGameState();
  });

  socket.on('edit_player', (edit_data, callback) => {
    if (!rejectUnlessAdmin(socket, callback)) {
      return;
    }

    const player_index = edit_data?.player_index;
    const time_ms = Number(edit_data?.time_ms);
    const turn_count = Number(edit_data?.turn_count);

    if (!validatePlayerIndex(player_index)) {
      callback?.({ success: false, message: 'Nieprawidłowy gracz.' });
      return;
    }

    if (!Number.isFinite(time_ms) || time_ms < 0) {
      callback?.({ success: false, message: 'Podaj prawidłowy czas.' });
      return;
    }

    if (!Number.isInteger(turn_count) || turn_count < 0) {
      callback?.({ success: false, message: 'Podaj prawidłową liczbę tur.' });
      return;
    }

    if (
      game_state.status === 'running' &&
      game_state.active_player_index === player_index
    ) {
      game_state.turn_started_at = Date.now();
    }

    game_state.player_times_ms[player_index] = Math.round(time_ms);
    game_state.player_turn_counts[player_index] = turn_count;

    callback?.({ success: true });
    broadcastGameState();
  });

  socket.on('pause_game', (callback) => {
    if (!rejectUnlessAdmin(socket, callback)) {
      return;
    }

    if (game_state.status !== 'running') {
      callback?.({ success: false, message: 'Gra nie jest w toku.' });
      return;
    }

    applyActivePlayerElapsedTime();
    game_state.status = 'paused';
    game_state.turn_started_at = null;

    callback?.({ success: true });
    broadcastGameState();
  });

  socket.on('resume_game', (callback) => {
    if (!rejectUnlessAdmin(socket, callback)) {
      return;
    }

    if (game_state.status !== 'paused') {
      callback?.({ success: false, message: 'Gra nie jest wstrzymana.' });
      return;
    }

    game_state.status = 'running';
    game_state.turn_started_at = Date.now();

    callback?.({ success: true });
    broadcastGameState();
  });

  socket.on('reset_game', (callback) => {
    if (!rejectUnlessAdmin(socket, callback)) {
      return;
    }

    game_state = createInitialGameState();

    for (const [socket_id, player_index] of socket_to_player.entries()) {
      game_state.connected_players[player_index] = socket_id;
    }

    callback?.({ success: true });
    broadcastGameState();
  });

  socket.on('disconnect', () => {
    releasePlayerSlot(socket.id);
    broadcastGameState();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const local_addresses = getLocalNetworkAddresses();

  console.log('');
  console.log('Game Timer is running.');
  console.log('');
  console.log(`  Saved game state:  ${GAME_STATE_FILE}`);
  console.log(`  Backup files:      ${BACKUP_DIRECTORY}`);
  console.log(`  Restored status:   ${game_state.status}`);
  console.log('');
  console.log(`  On this computer:  http://localhost:${PORT}`);

  if (local_addresses.length > 0) {
    console.log('');
    console.log('  On phones (same Wi-Fi):');

    for (const address of local_addresses) {
      console.log(`    http://${address}:${PORT}`);
    }
  } else {
    console.log('');
    console.log('  No local network address found. Use your computer IP manually.');
  }

  console.log('');
});
