const fs = require('fs');
const path = require('path');

const DATA_DIRECTORY = path.join(__dirname, 'data');
const GAME_STATE_FILE = path.join(DATA_DIRECTORY, 'game-state.json');
const BACKUP_DIRECTORY = path.join(DATA_DIRECTORY, 'backups');
const MAX_BACKUP_FILES = 10;

function ensureStorageDirectoriesExist() {
  fs.mkdirSync(DATA_DIRECTORY, { recursive: true });
  fs.mkdirSync(BACKUP_DIRECTORY, { recursive: true });
}

function createPersistedGameState(game_state) {
  const persisted_game_state = {
    status: game_state.status,
    active_player_index: game_state.active_player_index,
    turn_started_at: game_state.turn_started_at,
    player_times_ms: [...game_state.player_times_ms],
    player_turn_counts: [...game_state.player_turn_counts],
    player_additional_turns_used: [...game_state.player_additional_turns_used],
    player_turn_order: [...game_state.player_turn_order],
    connected_players: {},
    saved_at: Date.now()
  };

  if (
    persisted_game_state.status === 'running' &&
    persisted_game_state.turn_started_at !== null
  ) {
    const elapsed_time = Date.now() - persisted_game_state.turn_started_at;
    const active_player_index = persisted_game_state.active_player_index;
    persisted_game_state.player_times_ms[active_player_index] += elapsed_time;
    persisted_game_state.turn_started_at = Date.now();
  }

  return persisted_game_state;
}

function writeJsonFile(file_path, data) {
  const temporary_file_path = `${file_path}.tmp`;
  fs.writeFileSync(temporary_file_path, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(temporary_file_path, file_path);
}

function pruneOldBackupFiles() {
  const backup_files = fs
    .readdirSync(BACKUP_DIRECTORY)
    .filter((file_name) => file_name.startsWith('game-state-') && file_name.endsWith('.json'))
    .map((file_name) => ({
      file_name,
      file_path: path.join(BACKUP_DIRECTORY, file_name),
      modified_at: fs.statSync(path.join(BACKUP_DIRECTORY, file_name)).mtimeMs
    }))
    .sort((left_file, right_file) => right_file.modified_at - left_file.modified_at);

  for (const backup_file of backup_files.slice(MAX_BACKUP_FILES)) {
    fs.unlinkSync(backup_file.file_path);
  }
}

function createTimestampedBackup(persisted_game_state) {
  const timestamp_label = new Date().toISOString().replace(/[:.]/g, '-');
  const backup_file_path = path.join(
    BACKUP_DIRECTORY,
    `game-state-${timestamp_label}.json`
  );
  writeJsonFile(backup_file_path, persisted_game_state);
  pruneOldBackupFiles();
}

function saveGameState(game_state) {
  ensureStorageDirectoriesExist();

  const persisted_game_state = createPersistedGameState(game_state);

  if (fs.existsSync(GAME_STATE_FILE)) {
    const previous_game_state = fs.readFileSync(GAME_STATE_FILE, 'utf8');
    createTimestampedBackup(JSON.parse(previous_game_state));
  }

  writeJsonFile(GAME_STATE_FILE, persisted_game_state);

  if (persisted_game_state.status === 'running') {
    game_state.player_times_ms = [...persisted_game_state.player_times_ms];
    game_state.turn_started_at = persisted_game_state.turn_started_at;
  }
}

function normalizeLoadedGameState(loaded_game_state, createInitialGameState) {
  const initial_game_state = createInitialGameState();

  if (!loaded_game_state || typeof loaded_game_state !== 'object') {
    return initial_game_state;
  }

  const normalized_game_state = {
    status: loaded_game_state.status ?? initial_game_state.status,
    active_player_index: Number.isInteger(loaded_game_state.active_player_index)
      ? loaded_game_state.active_player_index
      : initial_game_state.active_player_index,
    turn_started_at:
      typeof loaded_game_state.turn_started_at === 'number'
        ? loaded_game_state.turn_started_at
        : null,
    player_times_ms: Array.isArray(loaded_game_state.player_times_ms)
      ? loaded_game_state.player_times_ms.map((time_value) => Math.max(0, Number(time_value) || 0))
      : [...initial_game_state.player_times_ms],
    player_turn_counts: Array.isArray(loaded_game_state.player_turn_counts)
      ? loaded_game_state.player_turn_counts.map((turn_count) =>
          Math.max(0, Number(turn_count) || 0)
        )
      : [...initial_game_state.player_turn_counts],
    player_additional_turns_used: Array.isArray(loaded_game_state.player_additional_turns_used)
      ? loaded_game_state.player_additional_turns_used.map((used_count) =>
          Math.max(0, Number(used_count) || 0)
        )
      : [...initial_game_state.player_additional_turns_used],
    player_turn_order: Array.isArray(loaded_game_state.player_turn_order)
      ? loaded_game_state.player_turn_order
      : [...initial_game_state.player_turn_order],
    connected_players: {}
  };

  if (normalized_game_state.player_times_ms.length !== 4) {
    normalized_game_state.player_times_ms = [...initial_game_state.player_times_ms];
  }

  if (normalized_game_state.player_turn_counts.length !== 4) {
    normalized_game_state.player_turn_counts = [...initial_game_state.player_turn_counts];
  }

  if (normalized_game_state.player_additional_turns_used.length !== 4) {
    normalized_game_state.player_additional_turns_used = [
      ...initial_game_state.player_additional_turns_used
    ];
  }

  if (
    normalized_game_state.player_turn_order.length !== 4 ||
    new Set(normalized_game_state.player_turn_order).size !== 4
  ) {
    normalized_game_state.player_turn_order = [...initial_game_state.player_turn_order];
  }

  if (!['waiting', 'running', 'paused', 'finished'].includes(normalized_game_state.status)) {
    normalized_game_state.status = 'waiting';
  }

  if (normalized_game_state.status === 'running' && normalized_game_state.turn_started_at === null) {
    normalized_game_state.turn_started_at = Date.now();
  }

  if (normalized_game_state.status === 'paused') {
    normalized_game_state.turn_started_at = null;
  }

  return normalized_game_state;
}

function loadGameState(createInitialGameState) {
  ensureStorageDirectoriesExist();

  if (!fs.existsSync(GAME_STATE_FILE)) {
    return createInitialGameState();
  }

  try {
    const loaded_game_state = JSON.parse(fs.readFileSync(GAME_STATE_FILE, 'utf8'));
    return normalizeLoadedGameState(loaded_game_state, createInitialGameState);
  } catch (error) {
    console.error('Could not load saved game state. Starting fresh.');
    console.error(error.message);
    return createInitialGameState();
  }
}

module.exports = {
  saveGameState,
  loadGameState,
  GAME_STATE_FILE,
  BACKUP_DIRECTORY
};
