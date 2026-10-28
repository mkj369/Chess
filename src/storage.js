/**
 * MKJ Chess — Local Storage
 * -----------------------------------------------------------------------------
 * Everything the app remembers lives on this device only. There is no login,
 * no backend and no network call. Storage failures (private browsing, quota
 * errors, corrupt JSON) degrade gracefully instead of breaking the game.
 */

const PREFIX = 'mkj.chess.';
const VERSION = 1;

/**
 * In-memory fallback so the app keeps working even when localStorage throws.
 * @type {Map<string,string>}
 */
const memory = new Map();

let storageUsable = null;

function probe() {
  try {
    const test = `${PREFIX}probe`;
    window.localStorage.setItem(test, '1');
    window.localStorage.removeItem(test);
    return true;
  } catch {
    return false;
  }
}

const localStorageOk = () => {
  if (storageUsable === null) storageUsable = probe();
  return storageUsable;
};

/** Set a flag on window so the UI can show a warning banner. */
if (typeof window !== 'undefined') {
  window.__MKJ_STORAGE_OK__ = localStorageOk();
}

function rawGet(key) {
  if (localStorageOk()) {
    try {
      return window.localStorage.getItem(PREFIX + key);
    } catch {
      /* fall through to memory */
    }
  }
  return memory.has(PREFIX + key) ? memory.get(PREFIX + key) : null;
}

function rawSet(key, value) {
  const full = PREFIX + key;
  if (localStorageOk()) {
    try {
      window.localStorage.setItem(full, value);
      return true;
    } catch {
      /* quota / private mode — fall through to memory */
    }
  }
  memory.set(full, value);
  return false;
}

function rawRemove(key) {
  const full = PREFIX + key;
  if (localStorageOk()) {
    try {
      window.localStorage.removeItem(full);
    } catch { /* ignore */ }
  }
  memory.delete(full);
}

/** Read + parse, returning `fallback` when the value is absent or corrupt. */
export function readJson(key, fallback) {
  const raw = rawGet(key);
  if (raw === null || raw === undefined) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

/** Write JSON. Returns true on success. Never throws. */
export function writeJson(key, value) {
  let serialised;
  try {
    serialised = JSON.stringify(value);
  } catch {
    return false;
  }
  return rawSet(key, serialised);
}

/** Read a plain string/number attribute, with a fallback. */
export function readAttr(key, fallback = null) {
  const raw = rawGet(key);
  return raw === null ? fallback : raw;
}

export function writeAttr(key, value) {
  return rawSet(key, String(value));
}

export function remove(key) {
  rawRemove(key);
}

/* ========================================================================== */
/* Default settings                                                           */
/* ========================================================================== */

export const DEFAULT_SETTINGS = {
  version: VERSION,
  theme: 'dark', // dark | light
  appearance: 'system', // system | dark | light
  boardTheme: 'grove',
  pieceTheme: 'stamped',
  showCoordinates: true,
  showLegalMoves: true,
  showHintArrow: false,
  showEvalBar: true,
  pieceAnimations: true,
  soundEnabled: true,
  soundVolume: 0.6,
  autoAdvance: false,
  flipBoard: false,
  // Defaults used when a new game starts.
  defaultDifficulty: 'medium',
  defaultSide: 'white',
  defaultTimeControl: 'none', // none | 1-0 | 2-1 | 3-0 | 3-2 | 5-0 | 10-0 | 15-10 | custom
  customTimeControl: '10-0',
  playerNames: { white: '', black: '' },
  clocksEnabled: false,
  premoveEnabled: false,
  // Analysis / hints
  hintEnabled: true,
  hintDifficulty: 'medium',
  // Pass & play extras
  randomStartFen: false,
};

/** Merged settings: stored values overwrite defaults. Unknown keys are kept. */
export function loadSettings() {
  const stored = readJson('settings', {}) || {};
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  merged.playerNames = { ...DEFAULT_SETTINGS.playerNames, ...(stored.playerNames || {}) };
  if (!Array.isArray(merged.customTimeControls)) merged.customTimeControls = [];
  return merged;
}

export function saveSettings(settings) {
  const payload = { ...settings, version: VERSION, savedAt: new Date().toISOString() };
  const ok = writeJson('settings', payload);
  if (!ok && typeof console !== 'undefined' && console.warn) {
    console.warn('MKJ Chess: settings could not be persisted (storage unavailable).');
  }
  return ok;
}

/* ========================================================================== */
/* Game history                                                               */
/* ========================================================================== */

export const MAX_GAMES = 100;

/**
 * @typedef {Object} GameRecord
 * @property {string} id
 * @property {string} mode
 * @property {'local'|'computer'} scope
 * @property {string} fen
 * @property {string} pgn
 * @property {string} result        PGN result string
 * @property {string} winner        'white' | 'black' | null
 * @property {string} difficulty
 * @property {string} whiteName
 * @property {string} blackName
 * @property {number} moves
 * @property {string} status
 * @property {number} playedAt     epoch ms
 * @property {number} seconds
 * @property {string|null} humanSide
 */

export function loadGames() {
  const raw = readJson('games', []);
  if (!Array.isArray(raw)) return [];
  return raw.filter((g) => g && typeof g === 'object').slice(0, MAX_GAMES);
}

export function saveGames(games) {
  const trimmed = games.slice(0, MAX_GAMES);
  return writeJson('games', trimmed);
}

export function addGame(record) {
  const games = loadGames();
  games.unshift(record);
  return saveGames(games) ? games : games;
}

export function clearGames() {
  return remove('games');
}

/* ========================================================================== */
/* Statistics                                                                 */
/* ========================================================================== */

export const DEFAULT_STATS = {
  version: VERSION,
  gamesPlayed: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  byDifficulty: {}, // { beginner: {played, won, lost, drawn}, ... }
  byScope: { local: { played: 0, won: 0, lost: 0, drawn: 0 }, computer: { played: 0, won: 0, lost: 0, drawn: 0 } },
  bestStreak: 0,
  currentStreak: 0,
  lastLossStreak: 0,
  totalMoves: 0,
  totalSeconds: 0,
};

function scopeKey(record) {
  return record.scope === 'computer' ? 'computer' : 'local';
}

/**
 * Recompute statistics from the real game history rather than trusting a
 * hand-edited counter. This guarantees the numbers the user sees match the
 * games actually played.
 */
export function rebuildStats(games) {
  const stats = {
    ...DEFAULT_STATS,
    byDifficulty: {},
    byScope: {
      local: { played: 0, won: 0, lost: 0, drawn: 0 },
      computer: { played: 0, won: 0, lost: 0, drawn: 0 },
    },
  };

  /**
   * Resolve whether the human player won a record. In computer games the human
   * plays `humanSide`; in local 1v1 no single human owns a side, so both sides
   * count as "a human won" and the record is simply not a loss.
   */
  const humanWon = (g) => {
    if (g.winner === null) return false;
    if (g.scope === 'local') return true; // either side played by a human
    if (g.humanSide === 'white') return g.winner === 'white';
    if (g.humanSide === 'black') return g.winner === 'black';
    return false;
  };

  const isDraw = (g) => g.winner === null;

  for (const g of games) {
    stats.gamesPlayed += 1;
    stats.totalMoves += g.moves || 0;
    stats.totalSeconds += g.seconds || 0;

    const diff = g.difficulty && g.difficulty !== 'none' ? g.difficulty : 'none';
    if (!stats.byDifficulty[diff]) {
      stats.byDifficulty[diff] = { played: 0, won: 0, lost: 0, drawn: 0 };
    }
    const bucket = stats.byDifficulty[diff];
    bucket.played += 1;

    const sbucket = stats.byScope[scopeKey(g)];
    sbucket.played += 1;

    if (isDraw(g)) {
      stats.draws += 1;
      bucket.drawn += 1;
      sbucket.drawn += 1;
    } else if (humanWon(g)) {
      stats.wins += 1;
      bucket.won += 1;
      sbucket.won += 1;
    } else {
      stats.losses += 1;
      bucket.lost += 1;
      sbucket.lost += 1;
    }
  }

  // Best/current streak: longest run of non-loss games, in chronological order.
  const ordered = [...games].reverse(); // oldest first
  let current = 0;
  let best = 0;
  for (const g of ordered) {
    if (isDraw(g) || humanWon(g)) {
      current += 1;
      if (current > best) best = current;
    } else {
      current = 0;
    }
  }
  stats.currentStreak = current;
  stats.bestStreak = best;

  return stats;
}

export function loadStats() {
  const stored = readJson('stats', DEFAULT_STATS);
  const stats = { ...DEFAULT_STATS, ...stored };
  if (!stats.byDifficulty || typeof stats.byDifficulty !== 'object') stats.byDifficulty = {};
  if (!stats.byScope || typeof stats.byScope !== 'object') {
    stats.byScope = { local: { played: 0, won: 0, lost: 0, drawn: 0 }, computer: { played: 0, won: 0, lost: 0, drawn: 0 } };
  }
  stats.bestStreak = Math.max(stats.bestStreak || 0, 0);
  return stats;
}

export function saveStats(stats) {
  return writeJson('stats', stats);
}

/**
 * Recompute stats from history, write them, and return the result.
 * Returns the stats so callers don't need to re-read.
 */
export function refreshStats() {
  const games = loadGames();
  const stats = rebuildStats(games);
  saveStats(stats);
  return stats;
}

export function resetStats() {
  return saveStats({ ...DEFAULT_STATS, version: VERSION });
}

/* ========================================================================== */
/* Misc state (current game, puzzle progress, etc.)                           */
/* ========================================================================== */

export function loadSession() {
  return readJson('session', {});
}

export function saveSession(session) {
  return writeJson('session', session);
}

/** Convenience: build a stable id for a game record. */
export function makeGameId() {
  return `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export { localStorageOk };
