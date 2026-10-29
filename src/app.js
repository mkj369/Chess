/**
 * MKJ Chess — Application Controller
 * -----------------------------------------------------------------------------
 * Screens, navigation, settings, statistics, the game bar, dialogs, puzzle and
 * practice modes, and PWA wiring. Everything runs locally in the browser.
 */

import {
  WHITE,
  BLACK,
  PAWN,
  KNIGHT,
  BISHOP,
  ROOK,
  QUEEN,
  KING,
  START_FEN,
  validateFen,
  positionToFen,
  toPgn,
  parsePgn,
  gameStatus,
  inCheck,
  moveToSan,
  PIECE_NAMES,
} from './chess-rules.js';
import {
  DIFFICULTY,
  DIFFICULTY_IDS,
  formatEvaluation,
} from './chess-engine.js';
import { sound } from './sound.js';
import {
  loadSettings,
  saveSettings,
  loadGames,
  saveGames,
  addGame,
  loadStats,
  refreshStats,
  resetStats,
  makeGameId,
  localStorageOk,
} from './storage.js';
import { TIME_CONTROLS, CUSTOM_LABEL, formatSeconds, parseCustomTimeControl } from './clock.js';
import { BoardView } from './board.js';
import { GameController, PIECE_SYMBOL } from './game.js';
import { PUZZLES } from './puzzles.js';
import { hasForcedMate } from './mate-search.js';

/* ========================================================================== */
/* Small DOM helpers                                                          */
/* ========================================================================== */

const $ = (id) => document.getElementById(id);
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function icon(id, cls = '') {
  return el('svg', { class: `mkj-ico ${cls}`.trim(), 'aria-hidden': 'true' }, [
    el('use', { href: `#${id}` }),
  ]);
}

function pieceSvg(type, color, size = 24) {
  const symbol = PIECE_SYMBOL[type][color === 'white' ? 'w' : 'b'];
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}"><use href="#${symbol}"/></svg>`;
}

function pieceHtml(type, color) {
  return `<span class="mkj-captured__piece is-${color}" title="${PIECE_NAMES[type]}">${pieceSvg(type, color, 24)}</span>`;
}

/* ========================================================================== */
/* Toasts & modals                                                            */
/* ========================================================================== */

let toastTimers = new WeakMap();

export function toast(message, kind = 'info', ms = 2600) {
  const root = $('mkj-toast-root');
  if (!root) return;
  const node = el('div', { class: `mkj-toast mkj-toast--${kind}`, role: 'status' }, [message]);
  root.appendChild(node);
  const timer = window.setTimeout(() => {
    node.classList.add('is-out');
    window.setTimeout(() => node.remove(), 260);
  }, ms);
  if (root.children.length > 4) {
    const oldest = root.firstElementChild;
    if (oldest !== node) oldest.remove();
  }
  void toastTimers;
  return timer;
}

/**
 * Open a modal. `actions` is an array of {label, value, kind, primary}.
 * Returns a Promise that resolves with the chosen value (or null if dismissed).
 */
export function modal({ title, subtitle, body, iconHtml = '', iconClass = '', actions = [], dismissable = true }) {
  return new Promise((resolve) => {
    const root = $('mkj-modal-root');
    let settled = false;

    const close = (value) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey);
      panel.remove();
      resolve(value);
    };

    const onKey = (e) => {
      if (e.key === 'Escape' && dismissable) {
        e.preventDefault();
        close(null);
      }
    };

    const panel = el('div', {
      class: 'mkj-modal',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': title,
    }, []);

    const inner = el('div', { class: 'mkj-modal__panel' });

    if (iconHtml) {
      const row = el('div', { class: 'mkj-modal__headrow' });
      row.appendChild(el('div', { class: `mkj-modal-icon ${iconClass}`.trim(), html: iconHtml }));
      const headText = el('div', { class: 'mkj-modal__headtext' });
      headText.appendChild(el('h2', { class: 'mkj-modal__title', text: title }));
      if (subtitle) headText.appendChild(el('p', { class: 'mkj-modal__sub', text: subtitle }));
      row.appendChild(headText);
      inner.appendChild(row);
    } else {
      inner.appendChild(el('h2', { class: 'mkj-modal__title', text: title }));
      if (subtitle) inner.appendChild(el('p', { class: 'mkj-modal__sub', text: subtitle }));
    }

    if (body) {
      const bodyEl = el('div', { class: 'mkj-modal__body' });
      if (typeof body === 'string') bodyEl.innerHTML = body;
      else bodyEl.appendChild(body);
      inner.appendChild(bodyEl);
    }

    const actionsEl = el('div', { class: 'mkj-modal__actions' });
    for (const a of actions) {
      const btn = el('button', {
        class: `mkj-btn ${a.primary ? 'mkj-btn--primary' : ''} ${a.kind === 'danger' ? 'mkj-btn--danger' : ''}`.trim(),
        type: 'button',
        onclick: () => close(a.value),
      }, [a.label]);
      actionsEl.appendChild(btn);
    }
    if (dismissable) {
      actionsEl.appendChild(
        el('button', { class: 'mkj-btn mkj-btn--ghost', type: 'button', onclick: () => close(null) }, ['Cancel']),
      );
    }
    inner.appendChild(actionsEl);

    panel.appendChild(inner);
    panel.addEventListener('mousedown', (e) => {
      if (e.target === panel && dismissable) close(null);
    });
    root.appendChild(panel);
    document.addEventListener('keydown', onKey);

    const first = qsa('button', inner)[0];
    if (first) first.focus();
  });
}

/** Ask the user to confirm something important. */
export async function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return modal({
    title,
    subtitle: message,
    iconHtml: danger ? '!' : '?',
    iconClass: danger ? 'is-danger' : '',
    actions: [{ label: confirmLabel, value: true, primary: !danger, kind: danger ? 'danger' : '' }],
  }).then((v) => v === true);
}

/* ========================================================================== */
/* Theme / board options                                                       */
/* ========================================================================== */

export const BOARD_THEMES = [
  { id: 'grove', label: 'Grove', light: '#ebe2cd', dark: '#7b6a4d' },
  { id: 'classic', label: 'Classic', light: '#f0d9b5', dark: '#b58863' },
  { id: 'modern', label: 'Modern', light: '#f2f0e6', dark: '#9aaf9a' },
  { id: 'ivory', label: 'Ivory', light: '#f7f2e3', dark: '#c8b994' },
  { id: 'parchment', label: 'Parchment', light: '#eddfc4', dark: '#8f7a56' },
  { id: 'midnight', label: 'Midnight', light: '#1f2734', dark: '#0b0f16' },
  { id: 'blue-chill', label: 'Blue Chill', light: '#d8e3ee', dark: '#8b9eb4' },
  { id: 'coral', label: 'Coral', light: '#f0e0d6', dark: '#c28b7b' },
  { id: 'sand', label: 'Sand', light: '#f5f0e3', dark: '#cbb489' },
  { id: 'marble', label: 'Marble', light: '#e6e5e1', dark: '#9b9a96' },
];

export const PIECE_THEMES = [
  { id: 'stamped', label: 'Stamped' },
  { id: 'solid', label: 'Solid' },
  { id: 'embossed', label: 'Embossed' },
  { id: 'crisp', label: 'Crisp' },
  { id: 'translucent', label: 'Glass' },
  { id: 'silhouette', label: 'Silhouette' },
];

/* ========================================================================== */
/* Application state                                                           */
/* ========================================================================== */

const state = {
  settings: loadSettings(),
  stats: loadStats(),
  games: loadGames(),
  screen: 'home',
  mode: null,
  controller: null,
  board: null,
  pendingPromotion: null,
  puzzleIndex: 0,
  puzzleSolved: 0,
  puzzleAttempts: 0,
};

function applyTheme() {
  const s = state.settings;
  let theme = s.theme;
  if (s.appearance === 'system') {
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    theme = prefersLight ? 'light' : 'dark';
  } else {
    theme = s.appearance;
  }
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-board', s.boardTheme);
  document.documentElement.setAttribute('data-pieces', s.pieceTheme);
  document.documentElement.setAttribute('data-anim', s.pieceAnimations ? 'on' : 'off');
}

function persist() {
  saveSettings(state.settings);
  refreshStats();
  state.stats = loadStats();
  state.games = loadGames();
}

/* ========================================================================== */
/* Screen navigation                                                           */
/* ========================================================================== */

const SCREEN_IDS = ['home', 'mode', 'game', 'settings', 'stats', 'about'];

function showScreen(name) {
  state.screen = name;
  for (const id of SCREEN_IDS) {
    const node = $(`mkj-screen-${id}`);
    if (!node) continue;
    if (id === name) {
      node.classList.add('is-active');
      node.removeAttribute('aria-hidden');
    } else {
      node.classList.remove('is-active');
      node.setAttribute('aria-hidden', 'true');
    }
  }
  if (name === 'home') renderHome();
  if (name === 'settings') renderSettings();
  if (name === 'stats') renderStats();
  if (name === 'about') renderAbout();
  if (name === 'mode') renderModeSelect();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ========================================================================== */
/* Home screen                                                                */
/* ========================================================================== */

function renderHome() {
  const list = $('mkj-recent-list');
  const empty = $('mkj-recent-empty');
  if (!list) return;
  list.innerHTML = '';

  const recent = state.games.slice(0, 6);
  if (!recent.length) {
    if (empty) empty.classList.remove('is-hidden');
    return;
  }
  if (empty) empty.classList.add('is-hidden');

  for (const g of recent) {
    const badgeClass = g.winner === 'white' ? 'mkj-badge--win'
      : g.winner === 'black' ? 'mkj-badge--loss' : 'mkj-badge--draw';
    const badgeText = g.winner === 'white' ? '1-0' : g.winner === 'black' ? '0-1' : '1/2-1/2';
    const date = new Date(g.playedAt);
    const item = el('button', {
      class: 'mkj-recent-item',
      type: 'button',
      onclick: () => importGame(g.pgn),
    }, [
      el('span', { class: 'mkj-recent-item__main' }, [
        el('span', { class: 'mkj-recent-item__title', text: `${g.whiteName} vs ${g.blackName}` }),
        el('span', { class: 'mkj-recent-item__meta', text: g.pgn.split('\n').filter((l) => l.trim() && !l.startsWith('[')).slice(0, 1).join(' ').slice(0, 60) || '—' }),
      ]),
      el('span', { class: `mkj-badge ${badgeClass}`, text: badgeText }),
      el('span', { class: 'mkj-recent-item__meta', text: date.toLocaleDateString() }),
    ]);
    list.appendChild(item);
  }
}

/* ========================================================================== */
/* Mode selection                                                             */
/* ========================================================================== */

function renderModeSelect() {
  const grid = $('mkj-modegrid');
  if (!grid) return;
  grid.innerHTML = '';

  const s = state.settings;
  const buildLocal = (mode, title, desc) => {
    const card = el('div', { class: 'mkj-modecard' });
    card.appendChild(el('div', { class: 'mkj-modecard__head' }, [
      el('span', { class: 'mkj-modecard__ico', html: icon('mkj-icon-people', 'mkj-ico--inline')?.outerHTML || '' }),
      el('span', { class: 'mkj-modecard__title', text: title }),
    ]));
    card.appendChild(el('p', { class: 'mkj-modecard__desc', text: desc }));
    return card;
  };

  /* ---------- Local 1v1 ---------- */
  const local = el('div', { class: 'mkj-modecard' });
  local.appendChild(el('div', { class: 'mkj-modecard__head' }, [
    el('span', { class: 'mkj-modecard__ico', html: `<svg class="mkj-ico"><use href="#mkj-icon-people"/></svg>` }),
    el('span', { class: 'mkj-modecard__title', text: 'MKJ Local 1v1' }),
  ]));
  local.appendChild(el('p', { class: 'mkj-modecard__desc', text: 'Two players share one device. Draw offers, resignation, rematch and optional clocks.' }));

  const localControls = el('div', { class: 'mkj-modecard__controls' });
  localControls.appendChild(el('div', { class: 'mkj-field' }, [
    el('span', { class: 'mkj-field__label', text: 'Board orientation' }),
    el('div', { class: 'mkj-options', id: 'mkj-opt-local-flip' }, [
      el('button', { class: 'mkj-option is-active', type: 'button', dataset: { value: 'white' } }, ['White at bottom']),
      el('button', { class: 'mkj-option', type: 'button', dataset: { value: 'black' } }, ['Black at bottom']),
    ]),
  ]));
  localControls.appendChild(el('div', { class: 'mkj-field' }, [
    el('span', { class: 'mkj-field__label', text: 'Chess clock' }),
    el('div', { class: 'mkj-options', id: 'mkj-opt-local-clock' }, buildClockOptions()),
  ]));
  localControls.appendChild(el('div', { class: 'mkj-field' }, [
    el('span', { class: 'mkj-field__label', text: 'Player names' }),
    el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px' }, [
      el('input', { class: 'mkj-input', type: 'text', id: 'mkj-inp-white', placeholder: 'White', value: state.settings.playerNames.white || '' }),
      el('input', { class: 'mkj-input', type: 'text', id: 'mkj-inp-black', placeholder: 'Black', value: state.settings.playerNames.black || '' }),
    ]),
  ]));
  local.appendChild(localControls);
  local.appendChild(el('button', { class: 'mkj-btn mkj-btn--primary mkj-btn--block', type: 'button', onclick: () => startGame('local') }, ['Start local game']));
  grid.appendChild(local);

  /* ---------- Computer ---------- */
  const cpu = el('div', { class: 'mkj-modecard' });
  cpu.appendChild(el('div', { class: 'mkj-modecard__head' }, [
    el('span', { class: 'mkj-modecard__ico', html: `<svg class="mkj-ico"><use href="#mkj-icon-cpu"/></svg>` }),
    el('span', { class: 'mkj-modecard__title', text: 'MKJ vs Computer' }),
  ]));
  cpu.appendChild(el('p', { class: 'mkj-modecard__desc', text: 'A real local engine with six difficulty levels. Every level only ever plays legal moves.' }));

  const cpuControls = el('div', { class: 'mkj-modecard__controls' });
  cpuControls.appendChild(el('div', { class: 'mkj-field' }, [
    el('span', { class: 'mkj-field__label', text: 'You play' }),
    el('div', { class: 'mkj-options', id: 'mkj-opt-cpu-side' }, [
      el('button', { class: 'mkj-option is-active', type: 'button', dataset: { value: 'white' } }, ['White']),
      el('button', { class: 'mkj-option', type: 'button', dataset: { value: 'black' } }, ['Black']),
    ]),
  ]));
  cpuControls.appendChild(el('div', { class: 'mkj-field' }, [
    el('span', { class: 'mkj-field__label', text: 'Difficulty' }),
    el('div', { class: 'mkj-options', id: 'mkj-opt-cpu-diff' }, DIFFICULTY_IDS.map((id) => {
      const d = DIFFICULTY[id];
      return el('button', {
        class: `mkj-option${d.id === state.settings.defaultDifficulty ? ' is-active' : ''}`,
        type: 'button',
        dataset: { value: d.id },
        title: d.describe,
      }, [d.label]);
    })),
  ]));
  const diffNote = el('p', { class: 'mkj-muted', style: 'font-size:12px' });
  diffNote.textContent = `${DIFFICULTY[state.settings.defaultDifficulty].label}: ${DIFFICULTY[state.settings.defaultDifficulty].describe}`;
  cpuControls.appendChild(diffNote);
  cpuControls.appendChild(el('div', { class: 'mkj-field' }, [
    el('span', { class: 'mkj-field__label', text: 'Chess clock' }),
    el('div', { class: 'mkj-options', id: 'mkj-opt-cpu-clock' }, buildClockOptions()),
  ]));
  cpu.appendChild(cpuControls);
  cpu.appendChild(el('button', { class: 'mkj-btn mkj-btn--primary mkj-btn--block', type: 'button', onclick: () => startGame('computer') }, ['Play the computer']));
  grid.appendChild(cpu);

  /* ---------- Pass & Play ---------- */
  const pp = el('div', { class: 'mkj-modecard' });
  pp.appendChild(el('div', { class: 'mkj-modecard__head' }, [
    el('span', { class: 'mkj-modecard__ico', html: `<svg class="mkj-ico"><use href="#mkj-icon-people"/></svg>` }),
    el('span', { class: 'mkj-modecard__title', text: 'Pass &amp; Play' }),
  ]));
  pp.appendChild(el('p', { class: 'mkj-modecard__desc', text: 'Same as Local 1v1 but with a quick random colour assignment. Hand the device over when it is your turn.' }));
  pp.appendChild(el('button', { class: 'mkj-btn mkj-btn--primary mkj-btn--block', type: 'button', onclick: () => startGame('passplay') }, ['Pass &amp; Play']));
  grid.appendChild(pp);

  /* ---------- Puzzles ---------- */
  const puz = el('div', { class: 'mkj-modecard' });
  puz.appendChild(el('div', { class: 'mkj-modecard__head' }, [
    el('span', { class: 'mkj-modecard__ico', html: `<svg class="mkj-ico"><use href="#mkj-icon-puzzle"/></svg>` }),
    el('span', { class: 'mkj-modecard__title', text: 'Puzzles' }),
  ]));
  puz.appendChild(el('p', { class: 'mkj-modecard__desc', text: `${PUZZLES.length} tactical puzzles. Each has a verified forced-mate solution — find the key move and deliver mate.` }));
  puz.appendChild(el('button', { class: 'mkj-btn mkj-btn--primary mkj-btn--block', type: 'button', onclick: () => startPuzzles() }, ['Solve puzzles']));
  grid.appendChild(puz);

  /* ---------- Practice ---------- */
  const prac = el('div', { class: 'mkj-modecard' });
  prac.appendChild(el('div', { class: 'mkj-modecard__head' }, [
    el('span', { class: 'mkj-modecard__ico', html: `<svg class="mkj-ico"><use href="#mkj-icon-book"/></svg>` }),
    el('span', { class: 'mkj-modecard__title', text: 'Practice Board' }),
  ]));
  prac.appendChild(el('p', { class: 'mkj-modecard__desc', text: 'Load any legal FEN and play it against the computer, or explore on your own. No recording, no clock pressure.' }));
  const pracControls = el('div', { class: 'mkj-modecard__controls' });
  pracControls.appendChild(el('div', { class: 'mkj-field' }, [
    el('span', { class: 'mkj-field__label', text: 'Position (FEN)' }),
    el('textarea', {
      class: 'mkj-input',
      id: 'mkj-inp-fen',
      rows: '3',
      style: 'resize:vertical;font-family:var(--mkj-font-mono);font-size:12.5px',
    }, [START_FEN]),
  ]));
  pracControls.appendChild(el('div', { class: 'mkj-field' }, [
    el('span', { class: 'mkj-field__label', text: 'Play against' }),
    el('div', { class: 'mkj-options', id: 'mkj-opt-prac-mode' }, [
      el('button', { class: 'mkj-option is-active', type: 'button', dataset: { value: 'human' } }, ['Just explore']),
      el('button', { class: 'mkj-option', type: 'button', dataset: { value: 'computer' } }, ['The computer']),
    ]),
  ]));
  pracControls.appendChild(el('div', { class: 'mkj-field' }, [
    el('span', { class: 'mkj-field__label', text: 'Computer difficulty' }),
    el('div', { class: 'mkj-options', id: 'mkj-opt-prac-diff' }, DIFFICULTY_IDS.map((id) =>
      el('button', { class: 'mkj-option', type: 'button', dataset: { value: id } }, [DIFFICULTY[id].label]),
    )),
  ]));
  prac.appendChild(pracControls);
  prac.appendChild(el('button', {
    class: 'mkj-btn mkj-btn--primary mkj-btn--block',
    type: 'button',
    onclick: () => startPractice(),
  }, ['Open practice board']));
  grid.appendChild(prac);

  wireOptionGroups([
    'mkj-opt-local-flip',
    'mkj-opt-local-clock',
    'mkj-opt-cpu-side',
    'mkj-opt-cpu-diff',
    'mkj-opt-cpu-clock',
    'mkj-opt-prac-mode',
    'mkj-opt-prac-diff',
  ]);

  // Wire the difficulty tooltip note.
  const note = qs('#mkj-opt-cpu-diff');
  if (note) {
    note.addEventListener('click', (e) => {
      const btn = e.target.closest('.mkj-option');
      if (!btn) return;
      const d = DIFFICULTY[btn.dataset.value];
      if (d) diffNote.textContent = `${d.label}: ${d.describe}`;
    });
  }
}

function buildClockOptions() {
  const opts = [{ id: 'none', label: 'None' }];
  for (const [id, tc] of Object.entries(TIME_CONTROLS)) opts.push({ id, label: tc.label });
  opts.push({ id: CUSTOM_LABEL, label: 'Custom…' });
  return opts.map((o) =>
    el('button', {
      class: `mkj-option${o.id === state.settings.defaultTimeControl ? ' is-active' : ''}`,
      type: 'button',
      dataset: { value: o.id },
    }, [o.label]),
  );
}

/** Make a group of .mkj-option buttons mutually exclusive. */
function wireOptionGroups(ids) {
  for (const id of ids) {
    const group = $(id);
    if (!group) continue;
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('.mkj-option');
      if (!btn) return;
      qsa('.mkj-option', group).forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      sound.ensureContext();
      sound.click();
    });
  }
}

/* ========================================================================== */
/* Starting games                                                              */
/* ========================================================================== */

function readOptionGroup(id) {
  const group = $(id);
  if (!group) return null;
  const active = qs('.mkj-option.is-active', group);
  return active ? active.dataset.value : null;
}

function startGame(mode) {
  const s = state.settings;
  const cfg = { mode };

  if (mode === 'local') {
    cfg.humanSide = WHITE;
    cfg.scope = 'local';
    cfg.names = {
      white: ($('mkj-inp-white')?.value || '').trim() || 'Player 1',
      black: ($('mkj-inp-black')?.value || '').trim() || 'Player 2',
    };
    cfg.timeControl = readOptionGroup('mkj-opt-local-clock') || 'none';
    cfg.flip = readOptionGroup('mkj-opt-local-flip') === 'black';
  } else if (mode === 'passplay') {
    cfg.humanSide = WHITE;
    cfg.scope = 'local';
    cfg.names = { white: 'Player 1', black: 'Player 2' };
    cfg.timeControl = 'none';
  } else if (mode === 'computer') {
    cfg.humanSide = readOptionGroup('mkj-opt-cpu-side') === 'black' ? BLACK : WHITE;
    cfg.scope = 'computer';
    cfg.difficulty = readOptionGroup('mkj-opt-cpu-diff') || s.defaultDifficulty;
    cfg.names = {
      white: cfg.humanSide === WHITE ? ($('mkj-inp-white')?.value || 'You') : 'MKJ Computer',
      black: cfg.humanSide === BLACK ? ($('mkj-inp-black')?.value || 'You') : 'MKJ Computer',
    };
    cfg.timeControl = readOptionGroup('mkj-opt-cpu-clock') || 'none';
  }

  s.defaultSide = cfg.humanSide;
  s.defaultDifficulty = cfg.difficulty || s.defaultDifficulty;
  s.defaultTimeControl = cfg.timeControl || s.defaultTimeControl;
  persist();

  openGameScreen();
  try {
    state.controller.start(cfg);
  } catch (err) {
    toast(err.message || 'Could not start the game.', 'error');
  }
}

function startPractice() {
  const fenInput = $('mkj-inp-fen');
  let fen = (fenInput?.value || '').trim();
  if (!fen) {
    toast('Enter a FEN first.', 'warn');
    return;
  }
  const check = validateFen(fen);
  if (!check.ok) {
    toast(check.error, 'error', 5000);
    return;
  }
  // Normalise: ensure a full 6-field FEN so the position renders consistently.
  const parts = fen.split(/\s+/);
  while (parts.length < 6) parts.push(parts.length === 4 ? '0' : '1');
  fen = parts.slice(0, 6).join(' ');

  const vsComputer = readOptionGroup('mkj-opt-prac-mode') === 'computer';
  openGameScreen();
  state.controller.start({
    mode: 'practice',
    scope: 'local',
    fen,
    practice: true,
    humanSide: WHITE,
    names: { white: 'You', black: vsComputer ? 'MKJ Computer' : 'Explorer' },
    difficulty: readOptionGroup('mkj-opt-prac-diff') || 'medium',
    timeControl: 'none',
  });
  if (vsComputer) toast('Practice board open — the computer will reply.', 'info');
}

function startPuzzles() {
  if (!PUZZLES.length) {
    toast('No puzzles are bundled.', 'warn');
    return;
  }
  state.puzzleIndex = 0;
  state.puzzleSolved = 0;
  state.puzzleAttempts = 0;
  openGameScreen();
  loadPuzzle(0);
}

function loadPuzzle(index) {
  const puzzle = PUZZLES[index];
  if (!puzzle) return;
  state.puzzleIndex = index;
  openGameScreen();
  state.controller.start({
    mode: 'puzzle',
    scope: 'local',
    fen: puzzle.fen,
    puzzle,
    practice: true,
    humanSide: WHITE,
    names: { white: 'You', black: 'Defender' },
    timeControl: 'none',
  });
  toast(`Puzzle ${index + 1}/${PUZZLES.length}: ${puzzle.theme}`, 'info');
}

function openGameScreen() {
  showScreen('game');
  buildGameBar();
}

/* ========================================================================== */
/* Game screen — bar, panels, wiring                                          */
/* ========================================================================== */

function buildGameBar() {
  const bar = $('mkj-gamebar');
  if (!bar) return;
  bar.innerHTML = '';

  const mk = (id, label, iconId, handler, opts = {}) =>
    el('button', {
      class: `mkj-btn ${opts.kind ? `mkj-btn--${opts.kind}` : ''}`.trim(),
      type: 'button',
      id: `mkj-gb-${id}`,
      onclick: handler,
      title: opts.title || label,
    }, [icon(iconId, 'mkj-ico--inline'), label]);

  bar.appendChild(mk('undo', 'Undo', 'mkj-icon-undo', () => state.controller.undo(), { title: 'Undo the last move (Ctrl+Z)' }));
  bar.appendChild(mk('redo', 'Redo', 'mkj-icon-redo', () => state.controller.redo(), { title: 'Redo (Ctrl+Y)' }));
  bar.appendChild(mk('flip', 'Flip', 'mkj-icon-flip', () => state.controller.toggleFlip(), { title: 'Flip the board' }));
  bar.appendChild(mk('hint', 'Hint', 'mkj-icon-info', () => state.controller.requestHint(), { title: 'Ask the engine for the best move' }));
  bar.appendChild(mk('restart', 'Restart', 'mkj-icon-refresh', () => restartGame(), { title: 'Start a new game of the same kind' }));

  if (state.mode === 'local' || state.mode === 'passplay') {
    bar.appendChild(mk('draw', 'Offer draw', 'mkj-icon-draw', () => state.controller.offerDraw(), { kind: 'ghost' }));
    bar.appendChild(mk('resign', 'Resign', 'mkj-icon-resign', () => resignGame(), { kind: 'danger' }));
  } else if (state.mode === 'computer') {
    bar.appendChild(mk('draw', 'Offer draw', 'mkj-icon-draw', () => state.controller.offerDraw(), { kind: 'ghost' }));
    bar.appendChild(mk('resign', 'Resign', 'mkj-icon-resign', () => resignGame(), { kind: 'danger' }));
  }
  bar.appendChild(mk('new', 'New game', 'mkj-icon-refresh', () => backToModes(), { kind: 'ghost' }));

  syncGameBar();
}

function syncGameBar() {
  const c = state.controller;
  if (!c) return;
  const set = (id, on) => { const n = $(`mkj-gb-${id}`); if (n) n.disabled = !on; };
  set('undo', c.canUndo());
  set('redo', c.canRedo());
  set('flip', true);
  set('hint', !c.over && !c.thinking);
  set('restart', !c.thinking);
  set('new', !c.thinking);
  if (state.mode === 'puzzle') {
    const r = $('mkj-gb-resign');
    if (r) r.style.display = 'none';
    const d = $('mkj-gb-draw');
    if (d) d.style.display = 'none';
  } else {
    for (const id of ['resign', 'draw']) {
      const n = $(`mkj-gb-${id}`);
      if (n) n.style.display = '';
    }
  }
}

async function resignGame() {
  const c = state.controller;
  if (!c || c.over) return;
  const ok = await confirmDialog({
    title: 'Resign?',
    message: `${c.colorName(c.game.position.turn)} will resign and the game will be recorded as a loss.`,
    confirmLabel: 'Resign',
    danger: true,
  });
  if (ok) c.resign();
}

async function restartGame() {
  const c = state.controller;
  if (!c) return;
  if (state.mode === 'puzzle') {
    loadPuzzle(state.puzzleIndex);
    return;
  }
  if (state.mode === 'practice') {
    startPractice();
    return;
  }
  const ok = await confirmDialog({
    title: 'Start a new game?',
    message: 'The current game will be abandoned.',
    confirmLabel: 'New game',
  });
  if (!ok) return;
  if (state.mode === 'local' || state.mode === 'passplay' || state.mode === 'computer') {
    startGame(state.mode);
  }
}

function backToModes() {
  stopGame();
  showScreen('mode');
}

function stopGame() {
  const c = state.controller;
  if (c) {
    c.stopComputer();
    c.closeClock();
  }
}

/* ---------- Panels ---------- */

function renderPlayerPanels(payload) {
  const c = state.controller;
  if (!c) return;
  const top = $('mkj-player-top');
  if (!top) return;
  top.innerHTML = '';

  const white = buildPlayerRow(WHITE, c.whiteName, c.controls, payload);
  const bottom = document.createElement('div');
  bottom.className = 'mkj-playerpanel';
  bottom.id = 'mkj-player-bottom';
  bottom.appendChild(buildPlayerRow(BLACK, c.blackName, c.controls, payload));
  bottom.style.marginTop = '0';
  // The board column is a flex column; insert the bottom panel after the board wrap.
  const wrap = $('mkj-boardwrap');
  if (wrap && wrap.nextSibling) {
    wrap.insertAdjacentElement('afterend', bottom);
  } else if (wrap) {
    wrap.parentNode.appendChild(bottom);
  }
  // Order: top panel, board, bottom panel.
  top.parentNode.insertBefore(bottom, null);
  top.appendChild(white);
}

function buildPlayerRow(color, name, controls, payload) {
  const isWhite = color === WHITE;
  const isActive = payload && payload.turn === color;
  const inCheck = payload && payload.check && payload.turn === color;

  const row = el('div', {
    class: `mkj-player ${isWhite ? 'is-white' : 'is-black'}${isActive ? ' is-active' : ''}`,
  });

  const mark = el('div', { class: 'mkj-player__mark', html: pieceSvg(KING, isWhite ? 'white' : 'black', 22) });
  row.appendChild(mark);

  const body = el('div', { class: 'mkj-player__body' });
  body.appendChild(el('div', { class: 'mkj-player__name', text: name || (isWhite ? 'White' : 'Black') }));
  const meta = el('div', { class: `mkj-player__meta${inCheck ? ' is-check' : ''}` });
  meta.textContent = inCheck ? 'In check — must respond' : isActive ? 'Thinking…' : 'Waiting';
  body.appendChild(meta);
  row.appendChild(body);

  const clock = el('div', { class: 'mkj-player__clock' });
  if (controls && payload && payload.clock && payload.clock.enabled) {
    const remaining = isWhite ? payload.clock.white : payload.clock.black;
    clock.classList.add(isActive ? 'is-active' : '');
    if (remaining <= 60) clock.classList.add('is-warning');
    clock.textContent = formatSeconds(remaining);
  } else {
    clock.classList.add('is-off');
  }
  row.appendChild(clock);

  return row;
}

function renderInfoPanel(payload) {
  const panel = $('mkj-panel-info');
  if (!panel) return;
  panel.innerHTML = '';

  const block = el('div', { class: 'mkj-info-block' });

  block.appendChild(el('div', { class: 'mkj-info-row' }, [
    el('span', { class: 'mkj-info-row__k', text: 'Turn' }),
    el('span', { class: 'mkj-info-row__v', text: payload.turn === WHITE ? 'White' : 'Black' }),
  ]));
  block.appendChild(el('div', { class: 'mkj-info-row' }, [
    el('span', { class: 'mkj-info-row__k', text: 'Moves' }),
    el('span', { class: 'mkj-info-row__v', text: String(payload.moves) }),
  ]));

  // Captured pieces.
  const capWrap = el('div', { style: 'margin-top:6px' });
  capWrap.appendChild(el('div', { class: 'mkj-field__label', text: 'Captured by White' }));
  const capWhite = el('div', { class: 'mkj-captured', html: renderCaptured(payload.capturedBlack) });
  capWrap.appendChild(capWhite);
  capWrap.appendChild(el('div', { class: 'mkj-field__label', style: 'margin-top:8px', text: 'Captured by Black' }));
  capWrap.appendChild(el('div', { class: 'mkj-captured', html: renderCaptured(payload.capturedWhite) }));
  block.appendChild(capWrap);

  if (payload.advantage) {
    const adv = el('span', { class: 'mkj-captured__advantage' });
    adv.textContent = `${payload.advantage} +${payload.advantagePawns.toFixed(1)}`;
    adv.style.color = state.settings.theme === 'light' ? 'var(--mkj-accent)' : 'var(--mkj-accent-hi)';
    block.appendChild(el('div', { class: 'mkj-info-row' }, [
      el('span', { class: 'mkj-info-row__k', text: 'Material' }),
      adv,
    ]));
  }

  // Evaluation bar.
  if (state.settings.showEvalBar !== false) {
    const barWrap = el('div', { style: 'margin-top:10px' });
    barWrap.appendChild(el('div', { class: 'mkj-field__label', text: 'Evaluation' }));
    const bar = el('div', { class: 'mkj-evalbar', role: 'img', 'aria-label': 'Evaluation bar' });
    const mid = el('div', { class: 'mkj-evalbar__mid' });
    const fill = el('div', { class: 'mkj-evalbar__fill' });
    const label = el('div', { class: 'mkj-evalbar__label' });
    bar.appendChild(mid);
    bar.appendChild(fill);
    bar.appendChild(label);
    barWrap.appendChild(bar);

    const analysis = state.controller?.lastHintMove;
    if (analysis) {
      const cp = analysis.score;
      const pawns = cp / 100;
      const clamped = Math.max(-7, Math.min(7, pawns));
      const half = 7 / 2;
      const pct = 50 + (clamped / 7) * 50;
      fill.style.width = `${Math.max(2, 50 - (pct - 50))}%`;
      fill.style.left = `${pct}%`;
      label.textContent = formatEvaluation(cp, payload.turn === WHITE ? WHITE : BLACK, analysis.mateIn);
    } else {
      label.textContent = '—';
      fill.style.width = '0%';
      fill.style.left = '50%';
    }
    block.appendChild(barWrap);
  }

  block.appendChild(el('div', { class: 'mkj-info-row' }, [
    el('span', { class: 'mkj-info-row__k', text: 'Repetition' }),
    el('span', { class: 'mkj-info-row__v', text: `${payload.repetition}${payload.repetition >= 2 ? '×' : ''}` }),
  ]));
  block.appendChild(el('div', { class: 'mkj-info-row' }, [
    el('span', { class: 'mkj-info-row__k', text: 'Half-moves' }),
    el('span', { class: 'mkj-info-row__v', text: String(payload.halfmove) }),
  ]));
  if (payload.fiftyClaimable) {
    block.appendChild(el('div', { class: 'mkj-info-row' }, [
      el('span', { class: 'mkj-info-row__k', text: '50-move rule' }),
      el('span', { class: 'mkj-info-row__v', text: 'Claimable', style: 'color:var(--mkj-warning)' }),
    ]));
  }
  block.appendChild(el('div', { class: 'mkj-info-row' }, [
    el('span', { class: 'mkj-info-row__k', text: 'Elapsed' }),
    el('span', { class: 'mkj-info-row__v', text: formatSeconds(payload.timeElapsed) }),
  ]));

  panel.appendChild(block);
}

function renderCaptured(list) {
  if (!list || !list.length) return '<span class="mkj-muted">none</span>';
  return list
    .slice()
    .sort((a, b) => PIECE_VALUES(a) - PIECE_VALUES(b))
    .map((type) => pieceHtml(type, 'black'))
    .join('');
}

function PIECE_VALUES(type) {
  return { [PAWN]: 1, [KNIGHT]: 3, [BISHOP]: 3, [ROOK]: 5, [QUEEN]: 9, [KING]: 0 }[type] || 0;
}

function renderHintPanel(analysis) {
  const panel = $('mkj-panel-hint');
  if (!panel) return;
  panel.innerHTML = '';
  if (!analysis) {
    panel.appendChild(el('p', { class: 'mkj-hint__empty', text: 'Press Hint to ask the engine for the best move. The move is shown on the board and explained here.' }));
    return;
  }
  const wrap = el('div', { class: 'mkj-hint' });
  wrap.appendChild(el('div', { class: 'mkj-hint__move', text: moveToSan(state.controller.game.position, analysis.move) }));
  wrap.appendChild(el('p', { class: 'mkj-hint__text', text: analysis.explanation || 'The engine suggests this move.' }));
  wrap.appendChild(el('p', { class: 'mkj-hint__text', style: 'font-size:12px;opacity:.75', text: `Search depth ${analysis.depth}, ${analysis.nodes} nodes, ${analysis.timeMs} ms.` }));
  panel.appendChild(wrap);
}

function renderMoveListPanel(rows) {
  const list = $('mkj-movelist');
  if (!list) return;
  list.innerHTML = '';
  for (const row of rows) {
    const item = el('li', { class: 'mkj-moverow' });
    item.appendChild(el('span', { class: 'mkj-moverow__num', text: String(row.number) + '.' }));
    const w = el('span', { class: `mkj-moverow__cell${row.white === row.san ? ' is-last' : ''}`, text: row.white || '' });
    const b = el('span', { class: `mkj-moverow__cell${row.black === row.san ? ' is-last' : ''}`, text: row.black || '' });
    item.appendChild(w);
    item.appendChild(b);
    list.appendChild(item);
  }
  list.scrollTop = list.scrollHeight;
}

/* ========================================================================== */
/* Settings screen                                                            */
/* ========================================================================== */

function renderSettings() {
  const root = $('mkj-settings');
  if (!root) return;
  root.innerHTML = '';

  const sections = [
    {
      title: 'Display',
      icon: 'mkj-icon-settings',
      rows: [
        { type: 'select', key: 'appearance', label: 'Appearance', options: [
          { value: 'system', label: 'Follow system' },
          { value: 'dark', label: 'Dark' },
          { value: 'light', label: 'Light' },
        ] },
        { type: 'swatches', key: 'boardTheme', label: 'Board colours', options: BOARD_THEMES },
        { type: 'swatches', key: 'pieceTheme', label: 'Piece style', options: PIECE_THEMES },
        { type: 'toggle', key: 'showCoordinates', label: 'Board coordinates' },
        { type: 'toggle', key: 'showLegalMoves', label: 'Legal-move indicators' },
        { type: 'toggle', key: 'showEvalBar', label: 'Evaluation bar' },
        { type: 'toggle', key: 'pieceAnimations', label: 'Piece animations' },
        { type: 'toggle', key: 'soundEnabled', label: 'Sound' },
      ],
    },
    {
      title: 'Gameplay',
      icon: 'mkj-icon-flag',
      rows: [
        { type: 'toggle', key: 'autoAdvance', label: 'Auto-claim the 50-move rule' },
        { type: 'select', key: 'defaultSide', label: 'Preferred side', options: [
          { value: 'white', label: 'White' },
          { value: 'black', label: 'Black' },
        ] },
        { type: 'select', key: 'defaultDifficulty', label: 'Default difficulty', options: DIFFICULTY_IDS.map((id) => ({ value: id, label: DIFFICULTY[id].label })) },
        { type: 'select', key: 'defaultTimeControl', label: 'Default clock', options: [
          { value: 'none', label: 'No clock' },
          ...Object.entries(TIME_CONTROLS).map(([id, tc]) => ({ value: id, label: tc.label })),
          { value: CUSTOM_LABEL, label: 'Custom' },
        ] },
        { type: 'customclock' },
        { type: 'toggle', key: 'flipBoard', label: 'Flip board for Black' },
        { type: 'toggle', key: 'hintEnabled', label: 'Enable hints' },
      ],
    },
    {
      title: 'Players',
      icon: 'mkj-icon-people',
      rows: [
        { type: 'input', key: 'playerNames.white', label: 'White player name' },
        { type: 'input', key: 'playerNames.black', label: 'Black player name' },
      ],
    },
    {
      title: 'Data',
      icon: 'mkj-icon-chart',
      rows: [
        { type: 'action-reset-games', label: 'Clear game history' },
        { type: 'action-reset-stats', label: 'Reset statistics' },
        { type: 'action-export', label: 'Export all games as PGN' },
      ],
    },
  ];

  for (const section of sections) {
    const card = el('div', { class: 'mkj-card' });
    card.appendChild(el('div', { class: 'mkj-card__title', html: `<svg class="mkj-ico">${iconHtmlFor(section.icon)}</svg> ${section.title}` }));
    for (const row of section.rows) {
      card.appendChild(buildSettingRow(row));
    }
    root.appendChild(card);
  }

  if (!localStorageOk()) {
    root.appendChild(el('div', { class: 'mkj-card' }, [
      el('div', { class: 'mkj-card__title', html: `<svg class="mkj-ico">${iconHtmlFor('mkj-icon-info')}</svg> Storage unavailable` }),
      el('p', { class: 'mkj-muted', text: 'This browser blocked local storage, so your settings, history and statistics will not be remembered between sessions. The game itself still works.' }),
    ]));
  }
}

function iconHtmlFor(id) {
  return `<use href="#${id}"/>`;
}

function buildSettingRow(row) {
  const wrap = el('div', { class: 'mkj-card__row' });

  if (row.type === 'toggle') {
    wrap.appendChild(el('label', { text: row.label, for: `mkj-set-${row.key}` }));
    const sw = el('label', { class: 'mkj-switch' });
    const input = el('input', {
      type: 'checkbox',
      id: `mkj-set-${row.key}`,
      checked: Boolean(state.settings[row.key]),
    });
    input.addEventListener('change', () => {
      state.settings[row.key] = input.checked;
      applyTheme();
      persist();
      if (row.key === 'soundEnabled') {
        sound.setEnabled(input.checked);
        if (input.checked) sound.click();
      }
      sound.ensureContext();
    });
    sw.appendChild(input);
    sw.appendChild(el('span', { class: 'mkj-switch__track' }));
    wrap.appendChild(sw);
    return wrap;
  }

  if (row.type === 'select') {
    wrap.appendChild(el('label', { text: row.label }));
    const select = el('select', { class: 'mkj-select', id: `mkj-set-${row.key}` });
    for (const opt of row.options) {
      select.appendChild(el('option', { value: opt.value, selected: String(state.settings[row.key]) === String(opt.value) }, [opt.label]));
    }
    select.addEventListener('change', () => {
      state.settings[row.key] = select.value;
      persist();
      if (row.key === 'boardTheme' || row.key === 'pieceTheme' || row.key === 'appearance') applyTheme();
    });
    wrap.appendChild(el('div', { class: 'mkj-row-control' }, [select]));
    return wrap;
  }

  if (row.type === 'swatches') {
    wrap.appendChild(el('label', { text: row.label }));
    const grid = el('div', { class: 'mkj-swatches' });
    for (const opt of row.options) {
      const isPiece = row.key === 'pieceTheme';
      const sw = el('button', {
        class: `mkj-swatch${state.settings[row.key] === opt.id ? ' is-active' : ''}`,
        type: 'button',
        title: opt.label,
        'aria-label': opt.label,
        'aria-pressed': state.settings[row.key] === opt.id ? 'true' : 'false',
        style: isPiece
          ? `background:linear-gradient(135deg,var(--mkj-piece-fill) 0 50%,var(--mkj-piece-fill-black) 50% 100%);border-color:${state.settings[row.key] === opt.id ? 'var(--mkj-accent)' : 'transparent'}`
          : `background:linear-gradient(135deg, ${opt.light} 0 50%, ${opt.dark} 50% 100%)`,
        onclick: () => {
          state.settings[row.key] = opt.id;
          applyTheme();
          persist();
          renderSettings();
          sound.ensureContext();
          sound.click();
        },
      });
      grid.appendChild(sw);
    }
    wrap.appendChild(grid);
    return wrap;
  }

  if (row.type === 'input') {
    const [head, tail] = row.key.split('.');
    const input = el('input', {
      class: 'mkj-input',
      type: 'text',
      id: `mkj-set-${row.key}`,
      value: String(state.settings[head]?.[tail] || ''),
    });
    input.addEventListener('change', () => {
      state.settings[head][tail] = input.value;
      persist();
    });
    wrap.appendChild(el('label', { text: row.label, for: `mkj-set-${row.key}` }));
    wrap.appendChild(el('div', { class: 'mkj-row-control' }, [input]));
    return wrap;
  }

  if (row.type === 'customclock') {
    wrap.appendChild(el('label', { text: 'Custom time control', for: 'mkj-set-customclock' }));
    const input = el('input', {
      class: 'mkj-input',
      type: 'text',
      id: 'mkj-set-customclock',
      value: state.settings.customTimeControl || '10-0',
      placeholder: '15+10',
    });
    input.addEventListener('change', () => {
      state.settings.customTimeControl = input.value;
      persist();
      const parsed = parseCustomTimeControl(input.value);
      toast(parsed ? `Custom clock set: ${parsed.label}` : 'Use a format like 15+10 or 25-0.', parsed ? 'success' : 'error');
    });
    wrap.appendChild(el('div', { class: 'mkj-row-control' }, [input]));
    return wrap;
  }

  if (row.type === 'action-reset-games') {
    wrap.appendChild(el('label', { text: row.label }));
    wrap.appendChild(el('div', { class: 'mkj-row-control' }, [
      el('button', {
        class: 'mkj-btn mkj-btn--danger mkj-btn--sm',
        type: 'button',
        onclick: async () => {
          const ok = await confirmDialog({ title: 'Clear game history?', message: `${state.games.length} recorded games will be deleted. Statistics will be recalculated.`, confirmLabel: 'Delete', danger: true });
          if (!ok) return;
          saveGames([]);
          persist();
          renderSettings();
          toast('Game history cleared.', 'success');
        },
      }, ['Clear']),
    ]));
    return wrap;
  }

  if (row.type === 'action-reset-stats') {
    wrap.appendChild(el('label', { text: row.label }));
    wrap.appendChild(el('div', { class: 'mkj-row-control' }, [
      el('button', {
        class: 'mkj-btn mkj-btn--danger mkj-btn--sm',
        type: 'button',
        onclick: async () => {
          const ok = await confirmDialog({ title: 'Reset statistics?', message: 'All win/loss/draw counts and streaks will be recalculated from your game history.', confirmLabel: 'Reset', danger: true });
          if (!ok) return;
          resetStats();
          persist();
          renderStats();
          toast('Statistics reset.', 'success');
        },
      }, ['Reset']),
    ]));
    return wrap;
  }

  if (row.type === 'action-export') {
    wrap.appendChild(el('label', { text: row.label }));
    wrap.appendChild(el('div', { class: 'mkj-row-control' }, [
      el('button', {
        class: 'mkj-btn mkj-btn--ghost mkj-btn--sm',
        type: 'button',
        onclick: () => {
          if (!state.games.length) { toast('No games recorded yet.', 'warn'); return; }
          const pgn = state.games.map((g) => g.pgn).join('\n\n');
          downloadFile('mkj-chess-games.pgn', pgn, 'text/plain');
          toast(`Exported ${state.games.length} games.`, 'success');
        },
      }, ['Export']),
    ]));
    return wrap;
  }

  return wrap;
}

function downloadFile(name, content, mime = 'text/plain') {
  try {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (err) {
    toast('Download failed: ' + err.message, 'error');
  }
}

/* ========================================================================== */
/* Statistics screen                                                          */
/* ========================================================================== */

function renderStats() {
  const root = $('mkj-stats');
  if (!root) return;
  const stats = state.stats;
  root.innerHTML = '';

  root.appendChild(el('div', { class: 'mkj-stats' }, [
    statBig(stats.gamesPlayed, 'Games played'),
    statBig(stats.wins, 'Wins'),
    statBig(stats.losses, 'Losses'),
    statBig(stats.draws, 'Draws'),
  ]));

  const winRate = stats.gamesPlayed ? Math.round((stats.wins / stats.gamesPlayed) * 100) : 0;
  root.appendChild(el('div', { class: 'mkj-stats' }, [
    statBig(`${winRate}%`, 'Win rate'),
    statBig(stats.bestStreak, 'Best streak'),
    statBig(stats.totalMoves, 'Total moves'),
    statBig(formatSeconds(stats.totalSeconds), 'Total time'),
  ]));

  // By difficulty.
  const diffCard = el('div', { class: 'mkj-card' });
  diffCard.appendChild(el('div', { class: 'mkj-card__title', html: `<svg class="mkj-ico">${iconHtmlFor('mkj-icon-flag')}</svg> Results by difficulty` }));
  const diffs = Object.keys(stats.byDifficulty).sort((a, b) => DIFFICULTY_IDS.indexOf(a) - DIFFICULTY_IDS.indexOf(b));
  if (!diffs.length) {
    diffCard.appendChild(el('p', { class: 'mkj-muted', text: 'Play the computer to see results by difficulty.' }));
  } else {
    const chart = el('div', { class: 'mkj-barchart' });
    for (const d of diffs) {
      const bucket = stats.byDifficulty[d];
      const label = DIFFICULTY[d] ? DIFFICULTY[d].label : d === 'none' ? 'Local games' : d;
      const rate = bucket.played ? Math.round((bucket.won / bucket.played) * 100) : 0;
      chart.appendChild(el('div', { class: 'mkj-barchart__row' }, [
        el('span', { text: label }),
        el('span', { class: 'mkj-barchart__track' }, [el('span', { class: 'mkj-barchart__fill', style: `width:${rate}%` })]),
        el('span', { class: 'mkj-barchart__val', text: `${bucket.won}-${bucket.lost}-${bucket.drawn}` }),
      ]));
      void rate;
    }
    diffCard.appendChild(chart);
  }
  root.appendChild(diffCard);

  // By scope.
  const scopeCard = el('div', { class: 'mkj-card' });
  scopeCard.appendChild(el('div', { class: 'mkj-card__title', html: `<svg class="mkj-ico">${iconHtmlFor('mkj-icon-people')}</svg> By game type` }));
  const chart = el('div', { class: 'mkj-barchart' });
  for (const scope of ['local', 'computer']) {
    const bucket = stats.byScope[scope] || { played: 0, won: 0, lost: 0, drawn: 0 };
    const rate = bucket.played ? Math.round((bucket.won / bucket.played) * 100) : 0;
    chart.appendChild(el('div', { class: 'mkj-barchart__row' }, [
      el('span', { text: scope === 'local' ? 'Local 1v1' : 'vs Computer' }),
      el('span', { class: 'mkj-barchart__track' }, [el('span', { class: 'mkj-barchart__fill', style: `width:${rate}%` })]),
      el('span', { class: 'mkj-barchart__val', text: `${bucket.played}` }),
    ]));
  }
  scopeCard.appendChild(chart);
  root.appendChild(scopeCard);

  const note = el('div', { class: 'mkj-card' });
  note.appendChild(el('div', { class: 'mkj-card__title', html: `<svg class="mkj-ico">${iconHtmlFor('mkj-icon-info')}</svg> How these numbers work` }));
  note.appendChild(el('p', { class: 'mkj-muted', style: 'font-size:13px;line-height:1.6', text: 'Statistics are recalculated from your recorded games every time they are opened, so they always match what actually happened. Nothing is sent anywhere — everything stays on this device. In local 1v1 games either side counts as a human win, so local games never appear as losses.' }));
  root.appendChild(note);
}

function statBig(num, label) {
  return el('div', { class: 'mkj-stat-big' }, [
    el('div', { class: 'mkj-stat-big__num', text: String(num) }),
    el('div', { class: 'mkj-stat-big__label', text: label }),
  ]);
}

/* ========================================================================== */
/* About screen                                                               */
/* ========================================================================== */

function renderAbout() {
  const body = $('mkj-about-body');
  if (!body) return;
  body.innerHTML = '';

  const card = el('div', { class: 'mkj-card' });
  card.appendChild(el('h2', { class: 'mkj-card__title', html: `<svg class="mkj-ico">${iconHtmlFor('mkj-icon-info')}</svg> About MKJ Chess` }));
  card.appendChild(el('p', { style: 'line-height:1.7;font-size:14px', text: 'MKJ Chess is a complete, offline chess platform: a full rules engine, a real search-based computer opponent, puzzles, a practice board, chess clocks, PGN and FEN import and export, and detailed local statistics.' }));
  card.appendChild(el('h3', { style: 'margin:18px 0 8px;font-size:14px', text: 'Rules' }));
  card.appendChild(el('p', { class: 'mkj-muted', style: 'font-size:13.5px;line-height:1.7', text: 'Standard 8x8 chess with all six piece types, castling (both sides, with every restriction), en passant, promotion to queen, rook, bishop or knight, check, checkmate and stalemate, the 50-move rule, threefold repetition and insufficient material. No illegal move can ever be played — the move generator verifies every move against the resulting position.' }));
  card.appendChild(el('h3', { style: 'margin:18px 0 8px;font-size:14px', text: 'The computer opponent' }));
  card.appendChild(el('p', { class: 'mkj-muted', style: 'font-size:13.5px;line-height:1.7', text: 'A real engine: negamax alpha-beta search with iterative deepening, a transposition table, quiescence search, null-move pruning, late move reductions and a tapered piece-square evaluation. Six difficulty levels change search depth, thinking time and error rate, so they really play at different strengths.' }));
  card.appendChild(el('h3', { style: 'margin:18px 0 8px;font-size:14px', text: 'Offline' }));
  card.appendChild(el('p', { class: 'mkj-muted', style: 'font-size:13.5px;line-height:1.7', text: 'Every piece of art, sound and data ships inside the application. There is no login, no backend and no network call during play. Settings, history and statistics are stored in the browser.' }));

  const facts = el('div', { class: 'mkj-info-block', style: 'margin-top:18px' });
  const addFact = (k, v) => facts.appendChild(el('div', { class: 'mkj-info-row' }, [
    el('span', { class: 'mkj-info-row__k', text: k }),
    el('span', { class: 'mkj-info-row__v', text: v }),
  ]));
  addFact('Pieces', 'Original vector artwork by MKJ');
  addFact('Sounds', 'Synthesized with the Web Audio API');
  addFact('Puzzles', `${PUZZLES.length} bundled, all with verified solutions`);
  addFact('Difficulty levels', `${DIFFICULTY_IDS.length}`);
  addFact('Saved locally', localStorageOk() ? 'Yes — localStorage' : 'No — this browser blocked it');
  card.appendChild(facts);
  body.appendChild(card);
}

/* ========================================================================== */
/* Import / export                                                            */
/* ========================================================================== */

async function importGame(pgnText) {
  const result = parsePgn(pgnText);
  if (!result.ok) {
    toast(result.error, 'error', 6000);
    return null;
  }
  const game = result.game;
  state.controller.start({
    mode: 'local',
    scope: 'local',
    fen: game.headers.FEN || START_FEN,
    humanSide: WHITE,
    names: { white: game.headers.White || 'White', black: game.headers.Black || 'Black' },
    timeControl: 'none',
  });
  // Apply the imported moves.
  for (const entry of game.history) {
    try {
      state.controller.playMove(entry.move);
    } catch {
      break;
    }
  }
  toast(`Imported ${game.history.length} move(s).`, 'success');
  return game;
}

async function openImportDialog() {
  const textarea = el('textarea', {
    class: 'mkj-input',
    rows: '10',
    style: 'width:100%;resize:vertical;font-family:var(--mkj-font-mono);font-size:12.5px;white-space:pre',
    placeholder: 'Paste a PGN game, or a FEN such as:\nrnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  });

  const value = await modal({
    title: 'Import a game',
    subtitle: 'Paste a PGN game or a single FEN position. Everything is validated before it is loaded.',
    iconHtml: '<svg class="mkj-ico" style="width:26px;height:26px"><use href="#mkj-icon-upload"/></svg>',
    body: textarea,
    actions: [{ label: 'Import', value: 'go', primary: true }],
  });

  if (value !== 'go') return;
  const text = textarea.value.trim();
  if (!text) { toast('Nothing to import.', 'warn'); return; }

  // A bare FEN is a position, not a game.
  if (!text.includes('[') && /^[rnbqkpRNBQKP1-8\s/]+/.test(text.split('\n')[0]) && text.split(/\s+/).length >= 4) {
    const check = validateFen(text);
    if (!check.ok) { toast(check.error, 'error', 6000); return; }
    state.controller.start({
      mode: 'practice',
      scope: 'local',
      fen: text,
      practice: true,
      humanSide: WHITE,
      names: { white: 'You', black: 'Explorer' },
      timeControl: 'none',
    });
    toast('Position loaded.', 'success');
    return;
  }

  await importGame(text);
}

/* ========================================================================== */
/* Keyboard shortcuts                                                          */
/* ========================================================================== */

function bindKeyboard() {
  document.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (typing) return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) state.controller?.redo();
      else state.controller?.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      state.controller?.redo();
      return;
    }
    if (e.key === 'Escape') {
      if (state.controller) state.controller.board.clearSelection();
      return;
    }
    if (state.screen !== 'game') return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const c = state.controller;
      if (!c || !c.game) return;
      e.preventDefault();
      c.undo();
      return;
    }
    if (e.key === 'h' || e.key === 'H') {
      state.controller?.requestHint();
      return;
    }
    if (e.key === 'f' || e.key === 'F') {
      state.controller?.toggleFlip();
    }
  });
}

/* ========================================================================== */
/* Puzzle mode logic                                                           */
/* ========================================================================== */

const PUZZLE_MAX_MOVES = 4;

function onPuzzleMove(entry) {
  const c = state.controller;
  const puzzle = state.puzzle;
  if (!puzzle || !c) return;

  // Black's reply in a puzzle is automatic; the defender is played by the engine.
  if (c.game.position.turn === BLACK) {
    c._computerMove();
    return;
  }

  const status = gameStatus(c.game);
  if (status.over && status.winner === WHITE) {
    state.puzzleSolved += 1;
    state.puzzleAttempts += 1;
    toast(`Solved in ${c.game.history.length} move(s)!`, 'success', 4000);
    setTimeout(() => {
      if (state.puzzleIndex < PUZZLES.length - 1) loadPuzzle(state.puzzleIndex + 1);
      else {
        toast(`All ${PUZZLES.length} puzzles solved. Excellent.`, 'success', 5000);
        backToModes();
      }
    }, 900);
    return;
  }

  if (status.over) {
    // Black was mated but the position is recorded as drawn/lost — shouldn't happen.
    return;
  }

  // Is the player's move still part of a forced mate?
  const mate = hasForcedMate(c.game.position, Math.max(1, PUZZLE_MAX_MOVES - c.game.history.length));
  if (!mate) {
    state.puzzleAttempts += 1;
    toast('That move does not force a mate. Try again.', 'error', 3500);
    c.undo();
    if (c.game.position.turn === BLACK) c._computerMove();
  }
}

/* ========================================================================== */
/* Boot                                                                       */
/* ========================================================================== */

let booted = false;

export async function boot() {
  if (booted) return;
  booted = true;

  applyTheme();

  // Honour a system preference change.
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => { if (state.settings.appearance === 'system') applyTheme(); };
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else if (mq.addListener) mq.addListener(handler);
  }

  sound.setEnabled(state.settings.soundEnabled !== false);
  sound.setVolume(Number(state.settings.soundVolume) || 0.6);

  // Build the board view and controller.
  const boardEl = $('mkj-board');
  const board = new BoardView(boardEl, {
    flipped: state.settings.flipBoard === true,
    onSquareClick: (sq) => state.controller?.handleSquareClick(sq),
  });
  board.build();
  board.applyCoordinates();

  const controller = new GameController({
    board,
    sound,
    settings: state.settings,
    onStatus: (payload) => {
      syncGameBar();
      renderPlayerPanels(payload);
      const banner = $('mkj-checkbanner');
      const bannerText = $('mkj-checkbanner-text');
      if (banner && bannerText) {
        if (payload.check) {
          bannerText.textContent = `Check — ${payload.turn === WHITE ? 'White' : 'Black'} must respond`;
          banner.classList.add('is-on');
        } else {
          banner.classList.remove('is-on');
        }
      }
    },
    onMove: (entry) => {
      if (state.mode === 'puzzle') onPuzzleMove(entry);
      else recordGameIfFinished();
    },
    onOver: (info) => showGameOverModal(info),
    onHistory: renderMoveListPanel,
    onInfo: (payload) => {
      renderInfoPanel(payload);
      renderPlayerPanels(payload);
    },
    onHint: renderHintPanel,
    onComputerState: (s) => {
      syncGameBar();
      if (s.thinking) {
        const bar = $('mkj-gamebar');
        if (bar) {
          let note = $('mkj-thinking');
          if (!note) {
            note = el('span', { id: 'mkj-thinking', class: 'mkj-thinking', style: 'font-size:12.5px;color:var(--mkj-accent-hi);padding:0 6px' });
            bar.appendChild(note);
          }
          note.textContent = 'MKJ is calculating…';
        }
      } else {
        const note = $('mkj-thinking');
        if (note) note.remove();
      }
    },
    onPromotion: (color) => choosePromotionPiece(color),
    onToast: (msg, kind) => toast(msg, kind),
    onDrawOffer: (byColor) => showDrawOfferModal(byColor),
  });

  state.board = board;
  state.controller = controller;

  // Tabs.
  for (const tab of qsa('.mkj-tab')) {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      for (const t of qsa('.mkj-tab')) {
        t.classList.toggle('is-active', t === tab);
        t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
      }
      for (const panel of qsa('.mkj-tabpanel')) {
        panel.classList.toggle('is-hidden', panel.id !== `mkj-panel-${target}`);
      }
    });
  }

  // Top bar.
  $('mkj-btn-home')?.addEventListener('click', () => {
    if (state.screen === 'game') backToModes();
    else showScreen('home');
  });
  $('mkj-btn-settings')?.addEventListener('click', () => showScreen('settings'));
  $('mkj-btn-stats')?.addEventListener('click', () => showScreen('stats'));
  $('mkj-btn-sound')?.addEventListener('click', (e) => {
    const on = !state.settings.soundEnabled;
    state.settings.soundEnabled = on;
    sound.setEnabled(on);
    saveSettings(state.settings);
    e.currentTarget.setAttribute('aria-pressed', on ? 'true' : 'false');
    e.currentTarget.innerHTML = '';
    e.currentTarget.appendChild(icon(on ? 'mkj-icon-sound' : 'mkj-icon-muted'));
    if (on) sound.click();
  });
  syncSoundButton();

  // Home actions.
  $('mkj-btn-play')?.addEventListener('click', () => showScreen('mode'));
  $('mkj-btn-about')?.addEventListener('click', () => showScreen('about'));
  $('mkj-btn-stats-home')?.addEventListener('click', () => showScreen('stats'));
  for (const btn of qsa('.mkj-menuitem')) {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (mode === 'local' || mode === 'computer' || mode === 'passplay' || mode === 'practice') {
        showScreen('mode');
        setTimeout(() => {
          const card = qsa('.mkj-modecard').find((c) => c.textContent.toLowerCase().includes(mode === 'passplay' ? 'pass' : mode === 'local' ? 'local 1v1' : mode === 'computer' ? 'computer' : 'practice'));
          if (card) {
            const btn2 = qsa('button', card).find((b) => b.classList.contains('mkj-btn--primary'));
            if (btn2) btn2.click();
          }
        }, 60);
      } else if (mode === 'puzzles') {
        startPuzzles();
      }
    });
  }

  // Game bar actions that live outside the controller.
  $('mkj-btn-copy-fen')?.addEventListener('click', copyFen);
  $('mkj-btn-export-pgn')?.addEventListener('click', exportPgn);
  $('mkj-btn-import')?.addEventListener('click', openImportDialog);

  bindKeyboard();

  // Hide the loader.
  const loader = $('mkj-loader');
  const fill = $('mkj-loader-fill');
  const statusEl = $('mkj-loader-status');
  const steps = [
    'Preparing the board…',
    'Loading the rules engine…',
    'Loading the MKJ computer opponent…',
    'Loading tactical puzzles…',
  ];
  let i = 0;
  const timer = window.setInterval(() => {
    i += 1;
    if (fill) fill.style.width = `${Math.min(100, i * 25)}%`;
    if (statusEl && steps[i]) statusEl.textContent = steps[i];
    if (i >= steps.length) {
      window.clearInterval(timer);
      if (loader) {
        loader.classList.add('is-hidden');
        loader.setAttribute('aria-hidden', 'true');
      }
      $('mkj-app').classList.remove('is-hidden');
      showScreen('home');
    }
  }, 220);

  // Register the service worker for offline PWA support when served over HTTP.
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* Offline support is optional; the app works without it. */
    });
  }
}

function syncSoundButton() {
  const btn = $('mkj-btn-sound');
  if (!btn) return;
  const on = state.settings.soundEnabled !== false;
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.innerHTML = '';
  btn.appendChild(icon(on ? 'mkj-icon-sound' : 'mkj-icon-muted'));
}

async function copyFen() {
  const c = state.controller;
  if (!c || !c.game) return;
  const fen = positionToFen(c.game.position);
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(fen);
    } else {
      const ta = el('textarea', { style: 'position:absolute;left:-9999px' });
      ta.value = fen;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast('FEN copied to the clipboard.', 'success');
  } catch {
    toast('Copy failed — the FEN is shown in the Info panel.', 'warn');
  }
}

async function exportPgn() {
  const c = state.controller;
  if (!c || !c.game) return;
  if (!c.game.history.length) { toast('No moves to export yet.', 'warn'); return; }
  const pgn = toPgn(c.game, {
    headers: {
      White: c.whiteName,
      Black: c.blackName,
      Event: state.mode === 'computer' ? `MKJ vs Computer (${DIFFICULTY[c.difficulty]?.label || c.difficulty})` : 'MKJ Chess game',
    },
  });
  downloadFile('mkj-chess-game.pgn', pgn, 'application/x-chess-pgn');
  toast('PGN exported.', 'success');
}

function showDrawOfferModal(byColor) {
  const c = state.controller;
  if (!c) return;
  const name = c.colorName(byColor);
  modal({
    title: 'Draw offer',
    subtitle: `${name} offers a draw.`,
    iconHtml: '<svg class="mkj-ico" style="width:26px;height:26px"><use href="#mkj-icon-draw"/></svg>',
    body: 'Accepting ends the game as a draw. Declining keeps the game going.',
    actions: [
      { label: 'Accept draw', value: 'accept', primary: true },
      { label: 'Decline', value: 'decline' },
    ],
  }).then((v) => {
    if (v === 'accept') c.acceptDraw();
    else c.declineDraw();
  });
}

function showGameOverModal(info) {
  const c = state.controller;
  if (!c) return;
  const winner = info.winner;
  const humanWon = winner !== null && c.humanSide && winner === c.humanSide;
  const isLocal = state.mode === 'local' || state.mode === 'passplay';

  let iconCls = '';
  let iconHtml = '?';
  if (winner === null) { iconCls = 'is-success'; iconHtml = '½'; }
  else if (isLocal) { iconCls = 'is-success'; iconHtml = '🏆'; }
  else if (humanWon) { iconCls = 'is-success'; iconHtml = '🏆'; }
  else { iconCls = 'is-danger'; iconHtml = '✕'; }

  const actions = [];
  if (state.mode === 'puzzle') {
    actions.push({ label: 'Next puzzle', value: 'next', primary: true });
    actions.push({ label: 'Back to modes', value: 'back' });
  } else {
    actions.push({ label: 'Rematch', value: 'rematch', primary: true });
    actions.push({ label: 'Back to modes', value: 'back' });
  }

  modal({
    title: winner === null ? 'The game is a draw' : (isLocal ? 'Game over' : humanWon ? 'You won' : 'The computer won'),
    subtitle: info.label,
    iconHtml: `<span style="font-family:var(--mkj-font-display);font-size:26px">${iconHtml}</span>`,
    iconClass: iconCls,
    body: `<p style="line-height:1.7">${winner === null
      ? 'Neither side can force a win, so the game is drawn.'
      : isLocal
        ? `${c.colorName(winner)} has won the game.`
        : humanWon
          ? `The MKJ computer at ${DIFFICULTY[c.difficulty]?.label || c.difficulty} difficulty has been beaten. Well played.`
          : `The ${DIFFICULTY[c.difficulty]?.label || c.difficulty}-level MKJ computer wins. Try a lower difficulty or analyse the position afterwards.`}</p>
       <p style="margin-top:10px;font-size:13px;opacity:.8">${c.game.history.length} moves played in ${formatSeconds(Math.floor((Date.now() - c.startedAt) / 1000))}.</p>`,
    actions,
  }).then((v) => {
    recordGameIfFinished(true);
    if (v === 'rematch') restartGame();
    else if (v === 'next') {
      if (state.puzzleIndex < PUZZLES.length - 1) loadPuzzle(state.puzzleIndex + 1);
      else backToModes();
    } else if (v === 'back') backToModes();
  });
}

/** Record a finished game in the local history, then refresh statistics. */
function recordGameIfFinished(force = false) {
  const c = state.controller;
  if (!c || !c.game) return;
  if (!force && !c.over) return;

  const status = gameStatus(c.game);
  if (!status.over && !force) return;

  const winner = c.over && c.gameOverReason ? c.gameOverReason.winner : status.winner;
  const result = c.result || (winner ? (winner === WHITE ? '1-0' : '0-1') : '1/2-1/2');

  const record = {
    id: makeGameId(),
    mode: state.mode,
    scope: state.mode === 'computer' ? 'computer' : 'local',
    fen: positionToFen(c.game.position),
    pgn: toPgn(c.game, {
      headers: {
        White: c.whiteName,
        Black: c.blackName,
        Event: state.mode === 'computer' ? `MKJ vs Computer (${DIFFICULTY[c.difficulty]?.label || c.difficulty})` : state.mode === 'practice' ? 'MKJ Practice' : 'MKJ Chess game',
      },
    }),
    result,
    winner: winner ? (winner === WHITE ? 'white' : 'black') : null,
    difficulty: state.mode === 'computer' ? c.difficulty : 'none',
    whiteName: c.whiteName,
    blackName: c.blackName,
    moves: c.game.history.length,
    status: status.status,
    playedAt: Date.now(),
    seconds: Math.floor((Date.now() - c.startedAt) / 1000),
    humanSide: state.mode === 'computer' ? (c.humanSide === WHITE ? 'white' : 'black') : null,
  };

  try {
    addGame(record);
    persist();
  } catch {
    /* Storage failure must never break gameplay. */
  }
}

/** Promotion picker. Resolves through a promise so the game can await it. */
function choosePromotionPiece(color) {
  return new Promise((resolve) => {
    const isWhite = color === WHITE;
    const choices = $('mkj-promotion-choices');
    const dialog = $('mkj-promotion');
    choices.innerHTML = '';
    dialog.classList.remove('is-hidden');
    dialog.setAttribute('aria-hidden', 'false');

    for (const type of [QUEEN, ROOK, BISHOP, KNIGHT]) {
      const btn = el('button', {
        class: `mkj-promotion__choice is-${isWhite ? 'w' : 'b'}`,
        type: 'button',
        'aria-label': `Promote to ${PIECE_NAMES[type]}`,
        title: PIECE_NAMES[type],
        onclick: () => {
          dialog.classList.add('is-hidden');
          dialog.setAttribute('aria-hidden', 'true');
          resolve({ promotion: type });
        },
      });
      btn.innerHTML = pieceSvg(type, isWhite ? 'white' : 'black', 46);
      choices.appendChild(btn);
    }
  });
}

/* ========================================================================== */
/* Entry point                                                                */
/* ========================================================================== */

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}
