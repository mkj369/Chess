/**
 * MKJ Chess — functional QA via jsdom (build-time only).
 *
 * Boots the real application inside a jsdom DOM (the actual index.html + all
 * ES-module source), then verifies:
 *
 *   Level 1 — app boot & DOM wiring
 *     - boots without throwing
 *     - 12 piece symbols present in the inline sprite
 *     - board builds 64 squares + MKJ branding overlay
 *     - "Start local game" renders 32 pieces with correct colour-aware symbols
 *     - tap-to-select shows the selection ring + legal-move dots
 *     - a tap-to-move updates the board + last-move highlight
 *
 *   Level 2 — controller game logic (direct GameController)
 *     - capture animation: captured piece falls, map stays correct, no dup
 *     - undo / redo restore and re-apply the capture
 *     - illegal target does not move the piece
 *     - checkmate detection (Ra8#) + check indicator
 *     - promotion flow (pawn -> queen via the promotion hook)
 *     - kingside castling (king + rook reposition)
 *     - en passant capture
 *     - computer (black) responds after white's move in computer mode
 *
 * Usage: node tools/qa-app.js
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
const lines = [];

function check(section, name, cond, extra = '') {
  if (cond) {
    pass++;
    lines.push(`  ✓ [${section}] ${name}`);
  } else {
    fail++;
    lines.push(`  ✗ [${section}] ${name}${extra ? ' — ' + extra : ''}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ========================================================================= */
/* Level 1 — full app boot                                                   */
/* ========================================================================= */

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, {
  url: 'http://localhost:5173/',
  pretendToBeVisual: true,
});
const { window } = dom;

// Expose the browser globals the modules expect.
globalThis.window = window;
globalThis.document = window.document;
// Node 22 has a read-only built-in navigator; override with jsdom's where possible.
try {
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
} catch { /* Node's navigator is fine for boot (no serviceWorker). */ }
globalThis.location = window.location;
globalThis.localStorage = window.localStorage;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.Event = window.Event;
globalThis.CustomEvent = window.CustomEvent;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);

let bootError = null;
try {
  const { boot } = await import('../src/app.js');
  await boot();
} catch (e) {
  bootError = e;
}

if (bootError) {
  console.log('BOOT FAILED:\n', bootError.stack || bootError.message);
  process.exit(1);
}

const doc = window.document;

// --- Sprite (the inline SVG has no id; count only piece symbols) ---
const pieceSymbols = doc.querySelectorAll('symbol[id^="mkj-piece-"]');
check('L1', '12 piece symbols in inline sprite', pieceSymbols.length === 12,
  `got ${pieceSymbols.length}`);
check('L1', 'no legacy single-colour piece symbols', doc.querySelectorAll('symbol[id^="piece-"]').length === 0);

// --- Board structure (built at boot, before a game starts) ---
const boardEl = doc.getElementById('mkj-board');
check('L1', 'board element present', !!boardEl);
check('L1', 'board has 64 squares', boardEl.querySelectorAll('.mkj-sq').length === 64,
  `got ${boardEl.querySelectorAll('.mkj-sq').length}`);
check('L1', 'MKJ branding overlay present', boardEl.querySelector('.mkj-boardbrand') !== null);

// --- Start a local game (navigate home -> mode -> start) ---
const playBtn = doc.getElementById('mkj-btn-play');
check('L1', 'home "Play" button found', !!playBtn);
if (playBtn) playBtn.click();
await sleep(50);
const startBtn = Array.from(doc.querySelectorAll('button')).find((b) => b.textContent.includes('Start local game'));
check('L1', '"Start local game" button found', !!startBtn);
if (startBtn) startBtn.click();
await sleep(50);

// --- Pieces render with correct symbols ---
const pieces = boardEl.querySelectorAll('.mkj-piece');
check('L1', '32 pieces rendered', pieces.length === 32, `got ${pieces.length}`);

const symbolCounts = {};
boardEl.querySelectorAll('use[href^="#mkj-piece-"]').forEach((u) => {
  const h = u.getAttribute('href');
  symbolCounts[h] = (symbolCounts[h] || 0) + 1;
});
check('L1', '8 white pawns use mkj-piece-wpawn', symbolCounts['#mkj-piece-wpawn'] === 8, `got ${symbolCounts['#mkj-piece-wpawn']}`);
check('L1', '8 black pawns use mkj-piece-bpawn', symbolCounts['#mkj-piece-bpawn'] === 8, `got ${symbolCounts['#mkj-piece-bpawn']}`);
check('L1', '1 white king uses mkj-piece-wking', symbolCounts['#mkj-piece-wking'] === 1, `got ${symbolCounts['#mkj-piece-wking']}`);
check('L1', '1 black king uses mkj-piece-bking', symbolCounts['#mkj-piece-bking'] === 1, `got ${symbolCounts['#mkj-piece-bking']}`);
check('L1', '16 white pieces have --w class', boardEl.querySelectorAll('.mkj-piece--w').length === 16, `got ${boardEl.querySelectorAll('.mkj-piece--w').length}`);
check('L1', '16 black pieces have --b class', boardEl.querySelectorAll('.mkj-piece--b').length === 16, `got ${boardEl.querySelectorAll('.mkj-piece--b').length}`);

// --- Tap-to-select + tap-to-move via real DOM clicks ---
function clickSq(sq) {
  const el = boardEl.querySelector(`.mkj-sq[data-sq="${sq}"]`);
  if (el) el.click();
  return !!el;
}

check('L1', 'click e2 (white pawn)', clickSq(12));
await sleep(20);
const e2sq = boardEl.querySelector('.mkj-sq[data-sq="12"]');
check('L1', 'e2 shows selection ring', e2sq && e2sq.classList.contains('is-selected'));
check('L1', 'legal-move dots appear', boardEl.querySelectorAll('.mkj-dot').length >= 2, `got ${boardEl.querySelectorAll('.mkj-dot').length}`);

check('L1', 'click e4 to move', clickSq(28));
await sleep(20);
check('L1', 'selection cleared after move', !e2sq.classList.contains('is-selected'));
check('L1', 'last-move highlight on e2', e2sq.classList.contains('is-last'));
check('L1', 'last-move highlight on e4', boardEl.querySelector('.mkj-sq[data-sq="28"]').classList.contains('is-last'));

/* ========================================================================= */
/* Level 2 — direct GameController logic                                     */
/* ========================================================================= */

const { BoardView } = await import('../src/board.js');
const { GameController } = await import('../src/game.js');
const { SoundEngine } = await import('../src/sound.js');

function makeController(fen, mode = 'local', startOpts = {}) {
  const el = doc.createElement('div');
  doc.body.appendChild(el);
  const board = new BoardView(el, {});
  board.build();
  const sound = new SoundEngine();
  const hooks = {
    onStatus: () => {},
    onMove: () => {},
    onOver: () => {},
    onHistory: () => {},
    onInfo: () => {},
    onHint: () => {},
    onComputerState: () => {},
    onPromotion: async () => ({ promotion: 'q' }),
    onToast: () => {},
    onDrawOffer: () => {},
    onSelect: () => {},
    onNewGame: () => {},
  };
  const settings = {
    showCoordinates: false,
    showLegalMoves: true,
    pieceAnimations: true,
    defaultDifficulty: 'easy',
    autoFifty: true,
  };
  const c = new GameController({ board, sound, settings, ...hooks });
  // Wire the board's square-click callback to the controller (used by the
  // pointer drag/tap handlers, not by direct handleSquareClick calls).
  board.options.onSquareClick = (sq) => c.handleSquareClick(sq);
  c.start({ mode, fen: fen || undefined, ...startOpts });
  return { c, board, el };
}

// --- Capture: 1.e4 d5 2.exd5 ---
{
  const t = makeController();
  t.c.handleSquareClick(12); t.c.handleSquareClick(28); // e2-e4
  t.c.handleSquareClick(51); t.c.handleSquareClick(35); // d7-d5
  t.c.handleSquareClick(28); t.c.handleSquareClick(35); // e4xd5 (capture)
  check('L2', 'capture move recorded (3 half-moves)', t.c.game.history.length === 3, `got ${t.c.game.history.length}`);
  check('L2', 'pieces map has 31 after capture', Object.keys(t.board.pieces).length === 31, `got ${Object.keys(t.board.pieces).length}`);
  check('L2', 'capturing pawn is on d5', t.board.board[35] > 0);
  await sleep(400);
  check('L2', 'DOM has 31 pieces after capture animation', t.el.querySelectorAll('.mkj-piece').length === 31, `got ${t.el.querySelectorAll('.mkj-piece').length}`);

  // Undo
  t.c.undo();
  check('L2', 'undo restores 32 pieces', Object.keys(t.board.pieces).length === 32, `got ${Object.keys(t.board.pieces).length}`);
  check('L2', 'undo reverts to 2 half-moves', t.c.game.history.length === 2);
  check('L2', 'undo returns pawn to e4', t.board.board[28] > 0 && t.board.board[35] < 0, `e4=${t.board.board[28]} d5=${t.board.board[35]}`);

  // Redo
  t.c.redo();
  check('L2', 'redo re-captures (31 pieces)', Object.keys(t.board.pieces).length === 31, `got ${Object.keys(t.board.pieces).length}`);
}

// --- Illegal move (a1 rook has no legal moves in the start position,
//     so use the e2 pawn which can reach e3/e4 but not e5) ---
{
  const t = makeController();
  t.c.handleSquareClick(12); // select e2 pawn
  check('L2', 'e2 pawn selectable', t.board.selected === 12, `got ${t.board.selected}`);
  // Click e5 (36) — not a legal target for an e2 pawn, and the square is empty.
  t.c.handleSquareClick(36);
  check('L2', 'illegal target keeps selection', t.board.selected === 12, `got ${t.board.selected}`);
  check('L2', 'illegal move not recorded', t.c.game.history.length === 0);
}

// --- Checkmate: Ra8# from back-rank setup ---
{
  const t = makeController('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
  t.c.handleSquareClick(0);  // a1 rook
  t.c.handleSquareClick(56); // a8
  await sleep(20);
  check('L2', 'checkmate detected', t.c.over === true);
  check('L2', 'checkmate result is 1-0', t.c.result === '1-0', `got ${t.c.result}`);
  check('L2', 'check indicator on g8 king square', t.board.el.querySelector('.mkj-sq[data-sq="62"]').classList.contains('mkj-sq--check'), `g8=${t.board.el.querySelector('.mkj-sq[data-sq="62"]')?.className}`);
}

// --- Promotion: e7-e8=Q ---
{
  const t = makeController('8/4P3/8/8/8/8/8/4K2k w - - 0 1');
  t.c.handleSquareClick(52); // e7 pawn
  await sleep(10);
  t.c.handleSquareClick(60); // e8 promote
  await sleep(50);
  check('L2', 'pawn promoted to queen on e8', t.board.board[60] === 5, `got ${t.board.board[60]}`);
  check('L2', 'promotion move recorded', t.c.game.history.length === 1);
}

// --- Castling (kingside): e1-g1, h1-f1 ---
{
  const t = makeController('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  t.c.handleSquareClick(4);  // e1 king
  await sleep(10);
  t.c.handleSquareClick(6);  // g1
  await sleep(20);
  check('L2', 'king moved to g1', t.board.board[6] === 6, `got ${t.board.board[6]}`);
  check('L2', 'rook moved to f1', t.board.board[5] === 4, `got ${t.board.board[5]}`);
  check('L2', 'e1 empty after castle', t.board.board[4] === 0);
  check('L2', 'h1 empty after castle', t.board.board[7] === 0);
}

// --- En passant: exf6 ---
{
  const t = makeController('8/8/8/4Pp2/8/8/8/4K2k w - f6 0 1');
  t.c.handleSquareClick(36); // e5 pawn
  await sleep(10);
  t.c.handleSquareClick(45); // f6 (en passant)
  await sleep(20);
  check('L2', 'en passant: white pawn on f6', t.board.board[45] > 0, `got ${t.board.board[45]}`);
  check('L2', 'en passant: f5 black pawn removed', t.board.board[37] === 0, `got ${t.board.board[37]}`);
  check('L2', 'en passant: e5 empty', t.board.board[36] === 0);
}

// --- Computer move: white moves, black (computer) responds ---
{
  const t = makeController(undefined, 'computer', { difficulty: 'easy', humanSide: 'w' });
  t.c.handleSquareClick(12); t.c.handleSquareClick(28); // e2-e4
  await sleep(700);
  check('L2', 'computer (black) responded', t.c.game.history.length === 2, `got ${t.c.game.history.length}`);
  check('L2', 'turn back to white after computer move', t.c.game.position.turn === 'w', `got ${t.c.game.position.turn}`);
  check('L2', 'computer not thinking', t.c.thinking === false);
}

// --- Drag & drop (pointer events; jsdom has no layout so the drop target
//     computes to -1, but we verify tap-select, drag-lift and cleanup) ---
{
  const t = makeController();
  const pawn = t.board.pieces[12]; // e2 pawn
  const PE = (type, x, y, id) => new window.PointerEvent(type, { clientX: x, clientY: y, pointerId: id, bubbles: true });

  // Tap: pointerdown + pointerup, no movement → selects (same as a click).
  pawn.dispatchEvent(PE('pointerdown', 100, 100, 1));
  window.dispatchEvent(PE('pointerup', 100, 100, 1));
  check('L2', 'tap (pointerdown+up) selects piece', t.board.selected === 12, `got ${t.board.selected}`);

  // Tap again → deselects.
  pawn.dispatchEvent(PE('pointerdown', 100, 100, 2));
  window.dispatchEvent(PE('pointerup', 100, 100, 2));
  check('L2', 'second tap deselects', t.board.selected === -1, `got ${t.board.selected}`);

  // Drag: pointerdown + pointermove (> 6px) → selects + lifts the piece.
  pawn.dispatchEvent(PE('pointerdown', 100, 100, 3));
  window.dispatchEvent(PE('pointermove', 140, 100, 3));
  check('L2', 'drag movement selects piece', t.board.selected === 12, `got ${t.board.selected}`);
  check('L2', 'dragging piece has is-dragging class', pawn.classList.contains('is-dragging'));

  // Drag end at an invalid location (jsdom returns -1) → no move, cleanup.
  window.dispatchEvent(PE('pointerup', 140, 100, 3));
  check('L2', 'drag end removes is-dragging', !pawn.classList.contains('is-dragging'));
  check('L2', 'no move on invalid drop', t.c.game.history.length === 0, `got ${t.c.game.history.length}`);
}

/* ========================================================================= */
/* Report                                                                    */
/* ========================================================================= */

console.log('\n================ LEVEL 1: App boot & DOM ================');
console.log(lines.filter((l) => l.includes('[L1]')).join('\n'));
console.log('\n================ LEVEL 2: Controller logic ================');
console.log(lines.filter((l) => l.includes('[L2]')).join('\n'));
console.log(`\n${fail === 0 ? 'ALL FUNCTIONAL CHECKS PASSED' : fail + ' CHECK(S) FAILED'} (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);
