const PLAYER_STORAGE_KEY = 'game_timer_player_index';
const PLAYER_NAMES = ['Czerwony', 'Niebieski', 'Żółty', 'Zielony'];
const PLAYER_COLOR_CLASSES = ['player_red', 'player_blue', 'player_yellow', 'player_green'];
const ADMIN_PLAYER_INDEX = 0;
const MAX_ADDITIONAL_TURNS_PER_TURN = 2;
const DEFAULT_SECONDS_PER_TURN = 30;
const DEFAULT_OVERTIME_POINTS_PER_MINUTE = 5;

const socket = io();

let current_player_index = null;
let latest_game_state = null;
let display_interval_id = null;
let editing_player_index = null;
let pending_additional_turn_confirmation_player_index = null;
let pending_additional_turn_confirmation_timeout_id = null;

const join_screen = document.getElementById('join_screen');
const game_screen = document.getElementById('game_screen');
const player_buttons = document.getElementById('player_buttons');
const join_hint = document.getElementById('join_hint');
const join_error = document.getElementById('join_error');
const your_player_label = document.getElementById('your_player_label');
const your_timer_section = document.getElementById('your_timer_section');
const edit_self_button = document.getElementById('edit_self_button');
const your_turn_count = document.getElementById('your_turn_count');
const your_pace_points = document.getElementById('your_pace_points');
const main_timer_value = document.getElementById('main_timer_value');
const other_players_row = document.getElementById('other_players_row');
const setup_card = document.getElementById('setup_card');
const turn_order_list = document.getElementById('turn_order_list');
const seconds_per_turn_input = document.getElementById('seconds_per_turn_input');
const overtime_points_per_minute_input = document.getElementById(
  'overtime_points_per_minute_input'
);
const start_game_button = document.getElementById('start_game_button');
const end_turn_button = document.getElementById('end_turn_button');
const additional_turn_button = document.getElementById('additional_turn_button');
const pause_button = document.getElementById('pause_button');
const resume_button = document.getElementById('resume_button');
const reset_button = document.getElementById('reset_button');
const change_player_button = document.getElementById('change_player_button');
const action_error = document.getElementById('action_error');
const admin_controls_card = document.getElementById('admin_controls_card');
const admin_action_controls = document.getElementById('admin_action_controls');
const edit_player_modal = document.getElementById('edit_player_modal');
const edit_player_title = document.getElementById('edit_player_title');
const edit_time_minutes = document.getElementById('edit_time_minutes');
const edit_time_seconds = document.getElementById('edit_time_seconds');
const edit_turn_count = document.getElementById('edit_turn_count');
const save_player_edit_button = document.getElementById('save_player_edit_button');
const cancel_player_edit_button = document.getElementById('cancel_player_edit_button');
const edit_player_error = document.getElementById('edit_player_error');

function isAdmin(player_index) {
  return player_index === ADMIN_PLAYER_INDEX;
}

function formatTime(milliseconds) {
  const total_seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(total_seconds / 60);
  const seconds = total_seconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatTurnCount(player_index, game_state) {
  const total_turn_count = game_state.player_turn_counts[player_index] ?? 0;
  const additional_turn_count = game_state.player_additional_turns_used?.[player_index] ?? 0;
  const regular_turn_count = Math.max(0, total_turn_count - additional_turn_count);

  return `${regular_turn_count}+${additional_turn_count}`;
}

function calculatePacePoints(player_index, time_ms, game_state) {
  const total_turn_count = game_state.player_turn_counts[player_index] ?? 0;
  const seconds_per_turn = game_state.seconds_per_turn ?? DEFAULT_SECONDS_PER_TURN;
  const overtime_points_per_minute =
    game_state.overtime_points_per_minute ?? DEFAULT_OVERTIME_POINTS_PER_MINUTE;
  const allowed_time_ms = total_turn_count * seconds_per_turn * 1000;
  const overtime_ms = Math.max(0, time_ms - allowed_time_ms);
  const overtime_seconds = overtime_ms / 1000;
  const overtime_points = Math.floor(
    (overtime_seconds * overtime_points_per_minute) / 60
  );

  return -overtime_points;
}

function formatPacePoints(player_index, time_ms, game_state) {
  return String(calculatePacePoints(player_index, time_ms, game_state));
}

function getDisplayTimes(game_state) {
  const display_times = [...game_state.player_times_ms];

  if (game_state.status === 'running' && game_state.turn_started_at !== null) {
    const elapsed_time = Date.now() - game_state.turn_started_at;
    const active_index = game_state.active_player_index;
    display_times[active_index] += elapsed_time;
  }

  return display_times;
}

function openEditPlayerModal(player_index) {
  if (!isAdmin(current_player_index) || !latest_game_state) {
    return;
  }

  editing_player_index = player_index;
  const display_times = getDisplayTimes(latest_game_state);
  const total_seconds = Math.max(0, Math.floor(display_times[player_index] / 1000));
  const minutes = Math.floor(total_seconds / 60);
  const seconds = total_seconds % 60;

  edit_player_title.textContent = `Edytuj: ${PLAYER_NAMES[player_index]}`;
  edit_time_minutes.value = String(minutes);
  edit_time_seconds.value = String(seconds);
  edit_turn_count.value = String(latest_game_state.player_turn_counts[player_index] ?? 0);
  showError(edit_player_error, '');
  edit_player_modal.hidden = false;
  edit_player_modal.classList.add('is_open');
}

function closeEditPlayerModal() {
  editing_player_index = null;
  edit_player_modal.hidden = true;
  edit_player_modal.classList.remove('is_open');
  showError(edit_player_error, '');
}

function savePlayerEdit() {
  if (editing_player_index === null) {
    return;
  }

  const minutes = Number(edit_time_minutes.value);
  const seconds = Number(edit_time_seconds.value);
  const turn_count = Number(edit_turn_count.value);

  if (
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds) ||
    minutes < 0 ||
    seconds < 0 ||
    seconds > 59
  ) {
    showError(edit_player_error, 'Podaj prawidłowy czas.');
    return;
  }

  if (!Number.isInteger(turn_count) || turn_count < 0) {
    showError(edit_player_error, 'Podaj prawidłową liczbę tur.');
    return;
  }

  const time_ms = Math.round((minutes * 60 + seconds) * 1000);

  socket.emit(
    'edit_player',
    {
      player_index: editing_player_index,
      time_ms,
      turn_count
    },
    (response) => {
      if (!response?.success) {
        showError(edit_player_error, response?.message ?? 'Nie udało się zapisać zmian.');
        return;
      }

      closeEditPlayerModal();
    }
  );
}

function getTurnOrder(game_state) {
  return game_state.player_turn_order ?? [0, 1, 2, 3];
}

function renderTurnOrderList(game_state) {
  if (!isAdmin(current_player_index) || game_state.status !== 'waiting') {
    turn_order_list.innerHTML = '';
    return;
  }

  const turn_order = getTurnOrder(game_state);
  turn_order_list.innerHTML = '';

  for (let order_position = 0; order_position < 4; order_position += 1) {
    const player_index = turn_order[order_position];
    const row = document.createElement('div');
    row.className = `turn_order_row ${PLAYER_COLOR_CLASSES[player_index]}`;

    const position_label = document.createElement('div');
    position_label.className = 'turn_order_position';
    position_label.textContent = String(order_position + 1);

    const player_name = document.createElement('div');
    player_name.className = 'turn_order_name';
    player_name.textContent = PLAYER_NAMES[player_index];

    const controls = document.createElement('div');
    controls.className = 'turn_order_controls';

    const move_up_button = document.createElement('button');
    move_up_button.className = 'secondary_button turn_order_button';
    move_up_button.type = 'button';
    move_up_button.textContent = 'W górę';
    move_up_button.dataset.orderPosition = String(order_position);
    move_up_button.dataset.direction = 'up';
    move_up_button.disabled = order_position === 0;

    const move_down_button = document.createElement('button');
    move_down_button.className = 'secondary_button turn_order_button';
    move_down_button.type = 'button';
    move_down_button.textContent = 'W dół';
    move_down_button.dataset.orderPosition = String(order_position);
    move_down_button.dataset.direction = 'down';
    move_down_button.disabled = order_position === 3;

    controls.append(move_up_button, move_down_button);
    row.append(position_label, player_name, controls);
    turn_order_list.appendChild(row);
  }
}


function showError(element, message) {
  if (!message) {
    element.hidden = true;
    element.textContent = '';
    return;
  }

  element.hidden = false;
  element.textContent = message;
}

function showJoinScreen() {
  closeEditPlayerModal();
  join_screen.hidden = false;
  game_screen.hidden = true;
  current_player_index = null;
  sessionStorage.removeItem(PLAYER_STORAGE_KEY);
}

function showGameScreen(player_index) {
  current_player_index = player_index;
  sessionStorage.setItem(PLAYER_STORAGE_KEY, String(player_index));
  join_screen.hidden = true;
  game_screen.hidden = false;
  your_player_label.textContent = PLAYER_NAMES[player_index];
  your_player_label.className = `your_timer_label ${PLAYER_COLOR_CLASSES[player_index]}`;
  showError(join_error, '');
  showError(action_error, '');
}

function updateJoinButtons(game_state) {
  const buttons = player_buttons.querySelectorAll('.player_button');

  for (const button of buttons) {
    const player_index = Number(button.dataset.playerIndex);
    const is_connected = Boolean(game_state.connected_players[player_index]);
    const is_you = current_player_index === player_index;

    button.disabled = is_connected && !is_you;
    button.classList.add(PLAYER_COLOR_CLASSES[player_index]);
    button.classList.toggle('is_connected', is_connected);
    button.textContent = is_connected
      ? `${PLAYER_NAMES[player_index]} (połączony)`
      : PLAYER_NAMES[player_index];
  }

  const connected_count = Object.keys(game_state.connected_players).length;
  join_hint.textContent =
    connected_count === 0
      ? 'Wybierz swój kolor. Każdy telefon musi wybrać inny.'
      : `${connected_count} z 4 graczy połączonych.`;
}

function getOtherPlayerIndexes(game_state) {
  return getTurnOrder(game_state).filter(
    (player_index) => player_index !== current_player_index
  );
}

function createOtherPlayerCell(player_index, elapsed_time, game_state) {
  const is_active =
    game_state.status === 'running' && game_state.active_player_index === player_index;

  const cell = document.createElement('div');
  cell.className = `other_player_cell ${PLAYER_COLOR_CLASSES[player_index]}`;
  cell.dataset.playerIndex = String(player_index);

  if (isAdmin(current_player_index)) {
    cell.classList.add('is_admin_editable');
  }

  if (is_active) {
    cell.classList.add('is_active');
  }

  const turn_count = document.createElement('div');
  turn_count.className = 'other_player_turn_count';
  turn_count.textContent = formatTurnCount(player_index, game_state);

  const pace_points = document.createElement('div');
  pace_points.className = 'other_player_pace_points';
  pace_points.textContent = formatPacePoints(player_index, elapsed_time, game_state);
  pace_points.classList.toggle(
    'is_negative',
    calculatePacePoints(player_index, elapsed_time, game_state) < 0
  );

  const name = document.createElement('div');
  name.className = 'other_player_name';
  name.textContent = PLAYER_NAMES[player_index];

  const time = document.createElement('div');
  time.className = 'other_player_time';
  time.textContent = formatTime(elapsed_time);

  cell.append(turn_count, pace_points, name, time);
  return cell;
}

function updateOtherPlayerCell(cell, player_index, elapsed_time, game_state) {
  const is_active =
    game_state.status === 'running' && game_state.active_player_index === player_index;

  cell.className = `other_player_cell ${PLAYER_COLOR_CLASSES[player_index]}`;
  if (isAdmin(current_player_index)) {
    cell.classList.add('is_admin_editable');
  }
  cell.classList.toggle('is_active', is_active);

  const turn_count = cell.querySelector('.other_player_turn_count');
  const pace_points = cell.querySelector('.other_player_pace_points');
  const time = cell.querySelector('.other_player_time');

  if (turn_count) {
    turn_count.textContent = formatTurnCount(player_index, game_state);
  }

  if (pace_points) {
    pace_points.textContent = formatPacePoints(player_index, elapsed_time, game_state);
    pace_points.classList.toggle(
      'is_negative',
      calculatePacePoints(player_index, elapsed_time, game_state) < 0
    );
  }

  if (time) {
    time.textContent = formatTime(elapsed_time);
  }
}

function renderOtherPlayersRow(display_times, game_state) {
  const other_player_indexes = getOtherPlayerIndexes(game_state);
  const existing_cells = [...other_players_row.querySelectorAll('.other_player_cell')];
  const existing_order = existing_cells.map((cell) => Number(cell.dataset.playerIndex));
  const order_matches =
    existing_order.length === other_player_indexes.length &&
    existing_order.every(
      (player_index, order_position) => player_index === other_player_indexes[order_position]
    );

  if (!order_matches) {
    other_players_row.innerHTML = '';

    for (const player_index of other_player_indexes) {
      other_players_row.appendChild(
        createOtherPlayerCell(player_index, display_times[player_index], game_state)
      );
    }

    return;
  }

  for (let order_position = 0; order_position < other_player_indexes.length; order_position += 1) {
    const player_index = other_player_indexes[order_position];
    updateOtherPlayerCell(
      existing_cells[order_position],
      player_index,
      display_times[player_index],
      game_state
    );
  }
}

function updatePaceSettingsInputs(game_state) {
  const seconds_per_turn = game_state.seconds_per_turn ?? DEFAULT_SECONDS_PER_TURN;
  const overtime_points_per_minute =
    game_state.overtime_points_per_minute ?? DEFAULT_OVERTIME_POINTS_PER_MINUTE;
  const inputs_are_editable = game_state.status === 'waiting' && isAdmin(current_player_index);

  if (document.activeElement !== seconds_per_turn_input) {
    seconds_per_turn_input.value = String(seconds_per_turn);
  }

  if (document.activeElement !== overtime_points_per_minute_input) {
    overtime_points_per_minute_input.value = String(overtime_points_per_minute);
  }

  seconds_per_turn_input.disabled = !inputs_are_editable;
  overtime_points_per_minute_input.disabled = !inputs_are_editable;
}

function updateActionButtons(game_state) {
  const is_running = game_state.status === 'running';
  const is_paused = game_state.status === 'paused';
  const is_waiting = game_state.status === 'waiting';
  const player_is_admin = isAdmin(current_player_index);
  const is_your_turn =
    is_running && game_state.active_player_index === current_player_index;
  const active_player_index = game_state.active_player_index;
  const active_player_name = PLAYER_NAMES[active_player_index];

  setup_card.hidden = !player_is_admin;
  setup_card.classList.toggle('is_hidden', !is_waiting || !player_is_admin);
  admin_controls_card.hidden = !player_is_admin;
  admin_action_controls.hidden = !player_is_admin;

  start_game_button.disabled = !is_waiting || !player_is_admin;

  if (player_is_admin && is_running) {
    end_turn_button.disabled = false;
    end_turn_button.textContent = `Zakończ turę: ${active_player_name}`;
  } else if (is_your_turn) {
    end_turn_button.disabled = false;
    end_turn_button.textContent = 'Zakończ moją turę';
  } else {
    end_turn_button.disabled = true;
    end_turn_button.textContent = player_is_admin
      ? `Zakończ turę: ${active_player_name}`
      : 'Zakończ moją turę';
  }

  pause_button.disabled = !is_running || !player_is_admin;
  pause_button.hidden = is_paused || !player_is_admin;
  resume_button.hidden = !is_paused || !player_is_admin;
  reset_button.disabled = !player_is_admin;

  const additional_turns_used =
    game_state.additional_turns_used_this_turn ?? 0;
  const additional_turns_remaining =
    MAX_ADDITIONAL_TURNS_PER_TURN - additional_turns_used;
  const can_use_additional_turn =
    is_running && additional_turns_remaining > 0 && (player_is_admin || is_your_turn);

  additional_turn_button.disabled = !can_use_additional_turn;
  if (!additional_turn_button.classList.contains('is_confirmed')) {
    additional_turn_button.textContent = 'Dodatkowa tura';
  }

  if (is_paused || is_waiting) {
    end_turn_button.disabled = true;
    additional_turn_button.disabled = true;
  }
}

function getAdditionalTurnCountElement(player_index) {
  if (player_index === current_player_index) {
    return your_turn_count;
  }

  return other_players_row.querySelector(
    `.other_player_cell[data-player-index="${player_index}"] .other_player_turn_count`
  );
}

function applyPendingTurnCountBump() {
  if (pending_additional_turn_confirmation_player_index === null) {
    return;
  }

  const turn_count_element = getAdditionalTurnCountElement(
    pending_additional_turn_confirmation_player_index
  );

  if (turn_count_element && !turn_count_element.classList.contains('is_bumped')) {
    turn_count_element.classList.add('is_bumped');
  }
}

function playAdditionalTurnConfirmation(active_player_index) {
  if (pending_additional_turn_confirmation_timeout_id !== null) {
    window.clearTimeout(pending_additional_turn_confirmation_timeout_id);
  }

  pending_additional_turn_confirmation_player_index = active_player_index;

  additional_turn_button.classList.remove('is_confirmed');
  // Restart CSS animation even if clicked again quickly.
  void additional_turn_button.offsetWidth;
  additional_turn_button.classList.add('is_confirmed');
  additional_turn_button.textContent = 'Dodano +1';

  const turn_count_element = getAdditionalTurnCountElement(active_player_index);

  if (turn_count_element) {
    turn_count_element.classList.remove('is_bumped');
    void turn_count_element.offsetWidth;
    turn_count_element.classList.add('is_bumped');
  }

  pending_additional_turn_confirmation_timeout_id = window.setTimeout(() => {
    pending_additional_turn_confirmation_player_index = null;
    pending_additional_turn_confirmation_timeout_id = null;
    additional_turn_button.classList.remove('is_confirmed');

    const finished_turn_count_element = getAdditionalTurnCountElement(active_player_index);
    if (finished_turn_count_element) {
      finished_turn_count_element.classList.remove('is_bumped');
    }

    if (latest_game_state) {
      updateActionButtons(latest_game_state);
    }
  }, 900);
}

function renderGameState(game_state) {
  latest_game_state = game_state;

  if (current_player_index === null) {
    updateJoinButtons(game_state);
    return;
  }

  const display_times = getDisplayTimes(game_state);
  const your_time = display_times[current_player_index];
  const is_your_turn =
    game_state.status === 'running' &&
    game_state.active_player_index === current_player_index;

  main_timer_value.textContent = formatTime(your_time);
  your_turn_count.textContent = formatTurnCount(current_player_index, game_state);
  const your_points = calculatePacePoints(current_player_index, your_time, game_state);
  your_pace_points.textContent = String(your_points);
  your_pace_points.classList.toggle('is_negative', your_points < 0);
  your_timer_section.className = `your_timer_section ${PLAYER_COLOR_CLASSES[current_player_index]}`;
  your_timer_section.classList.toggle('is_active', is_your_turn);
  edit_self_button.hidden = !isAdmin(current_player_index);

  renderOtherPlayersRow(display_times, game_state);
  renderTurnOrderList(game_state);
  updatePaceSettingsInputs(game_state);
  updateActionButtons(game_state);
  updateJoinButtons(game_state);
  applyPendingTurnCountBump();
}

function joinPlayer(player_index) {
  showError(join_error, '');

  socket.emit('join', player_index, (response) => {
    if (!response?.success) {
      showError(join_error, response?.message ?? 'Nie udało się dołączyć.');
      return;
    }

    showGameScreen(player_index);
    renderGameState(latest_game_state ?? {
      status: 'waiting',
      active_player_index: 0,
      turn_started_at: null,
      player_times_ms: [0, 0, 0, 0],
      player_turn_counts: [0, 0, 0, 0],
      player_additional_turns_used: [0, 0, 0, 0],
      additional_turns_used_this_turn: 0,
      seconds_per_turn: DEFAULT_SECONDS_PER_TURN,
      overtime_points_per_minute: DEFAULT_OVERTIME_POINTS_PER_MINUTE,
      player_turn_order: [0, 1, 2, 3],
      connected_players: {}
    });
  });
}

function emitWithFeedback(event_name, argument, error_element) {
  showError(error_element, '');

  socket.emit(event_name, argument, (response) => {
    if (!response?.success) {
      showError(error_element, response?.message ?? 'Akcja nie powiodła się.');
    }
  });
}

player_buttons.addEventListener('click', (event) => {
  const button = event.target.closest('.player_button');

  if (!button || button.disabled) {
    return;
  }

  joinPlayer(Number(button.dataset.playerIndex));
});

change_player_button.addEventListener('click', () => {
  showJoinScreen();
  if (latest_game_state) {
    updateJoinButtons(latest_game_state);
  }
});

start_game_button.addEventListener('click', () => {
  showError(action_error, '');

  socket.emit(
    'start_game',
    {
      seconds_per_turn: Number(seconds_per_turn_input.value),
      overtime_points_per_minute: Number(overtime_points_per_minute_input.value)
    },
    (response) => {
      if (!response?.success) {
        showError(action_error, response?.message ?? 'Akcja nie powiodła się.');
      }
    }
  );
});

function emitPaceSettingsUpdate() {
  if (!isAdmin(current_player_index) || latest_game_state?.status !== 'waiting') {
    return;
  }

  showError(action_error, '');

  socket.emit(
    'update_pace_settings',
    {
      seconds_per_turn: Number(seconds_per_turn_input.value),
      overtime_points_per_minute: Number(overtime_points_per_minute_input.value)
    },
    (response) => {
      if (!response?.success) {
        showError(action_error, response?.message ?? 'Nie udało się zapisać ustawień.');
      }
    }
  );
}

seconds_per_turn_input.addEventListener('change', emitPaceSettingsUpdate);
overtime_points_per_minute_input.addEventListener('change', emitPaceSettingsUpdate);

turn_order_list.addEventListener('click', (event) => {
  const button = event.target.closest('.turn_order_button');

  if (!button || button.disabled) {
    return;
  }

  socket.emit(
    'move_player_in_turn_order',
    {
      order_position: Number(button.dataset.orderPosition),
      direction: button.dataset.direction
    },
    (response) => {
      if (!response?.success) {
        showError(action_error, response?.message ?? 'Nie udało się zmienić kolejności.');
      } else {
        showError(action_error, '');
      }
    }
  );
});

end_turn_button.addEventListener('click', () => {
  emitWithFeedback('end_turn', null, action_error);
});

additional_turn_button.addEventListener('click', () => {
  showError(action_error, '');

  const active_player_index = latest_game_state?.active_player_index;

  socket.emit('additional_turn', (response) => {
    if (!response?.success) {
      showError(action_error, response?.message ?? 'Akcja nie powiodła się.');
      return;
    }

    if (Number.isInteger(active_player_index)) {
      playAdditionalTurnConfirmation(active_player_index);
    }
  });
});

other_players_row.addEventListener('click', (event) => {
  if (!isAdmin(current_player_index)) {
    return;
  }

  const cell = event.target.closest('.other_player_cell');

  if (!cell) {
    return;
  }

  openEditPlayerModal(Number(cell.dataset.playerIndex));
});

edit_self_button.addEventListener('click', (event) => {
  event.stopPropagation();
  openEditPlayerModal(current_player_index);
});

save_player_edit_button.addEventListener('click', (event) => {
  event.stopPropagation();
  savePlayerEdit();
});

cancel_player_edit_button.addEventListener('click', (event) => {
  event.stopPropagation();
  closeEditPlayerModal();
});

edit_player_modal.addEventListener('click', (event) => {
  if (event.target === edit_player_modal) {
    closeEditPlayerModal();
  }
});

edit_player_modal.querySelector('.modal_card').addEventListener('click', (event) => {
  event.stopPropagation();
});

pause_button.addEventListener('click', () => {
  emitWithFeedback('pause_game', null, action_error);
});

resume_button.addEventListener('click', () => {
  emitWithFeedback('resume_game', null, action_error);
});

reset_button.addEventListener('click', () => {
  if (!window.confirm('Zresetować grę dla wszystkich?')) {
    return;
  }

  emitWithFeedback('reset_game', null, action_error);
});

socket.on('game_state', (game_state) => {
  renderGameState(game_state);
});

socket.on('connect', () => {
  const stored_player_index = sessionStorage.getItem(PLAYER_STORAGE_KEY);

  if (stored_player_index !== null) {
    joinPlayer(Number(stored_player_index));
  }
});

display_interval_id = window.setInterval(() => {
  if (latest_game_state && current_player_index !== null) {
    renderGameState(latest_game_state);
  }
}, 250);

window.addEventListener('beforeunload', () => {
  window.clearInterval(display_interval_id);
});
