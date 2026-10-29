/**
 * MKJ Chess — verification of rendering-fix patches.
 * Tests: (1) HTML entity fix, (2) _updatePieceVisual stale sprite fix,
 * (3) piece SVG sizing CSS, (4) initial game state.
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Boot the app
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf-8');
const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, url: 'http://localhost/' });
const { window } = dom;

globalThis.window = window;
globalThis.document = window.document;
try { Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true }); } catch {}
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
} catch (e) { bootError = e; }
if (bootError) { console.log('BOOT FAILED:', bootError); process.exit(1); }

const doc = window.document;

// --- Test 1: HTML entity fix ---
console.log('\n== Test 1: HTML entity fix ==');
const allBtns = Array.from(doc.querySelectorAll('button'));
const ppBtn = allBtns.find(b => b.textContent.includes('Pass'));
check('Pass & Play button found', !!ppBtn);
if (ppBtn) {
  check('Pass & Play text does not contain &amp;', !ppBtn.textContent.includes('&amp;'), `got "${ppBtn.textContent}"`);
  check('Pass & Play text contains literal &', ppBtn.textContent.includes('&'));
}

// Check JS source doesn't have the entity
const appSrc = readFileSync(new URL('../src/app.js', import.meta.url), 'utf-8');
check('app.js has no Pass &amp; Play in JS strings', !appSrc.includes("'Pass &amp; Play'"));

// --- Test 2: Start local game and verify initial state ---
console.log('\n== Test 2: Initial game state ==');
const playBtn = doc.getElementById('mkj-btn-play');
if (playBtn) playBtn.click();
await sleep(50);
const startBtn = Array.from(doc.querySelectorAll('button')).find(b => b.textContent.includes('Start local game'));
if (startBtn) startBtn.click();
await sleep(50);

const boardEl = doc.getElementById('mkj-board');
const pieces = boardEl.querySelectorAll('.mkj-piece');
check('32 pieces rendered', pieces.length === 32, `got ${pieces.length}`);

// Check no check indicator on initial state
const checkIndicator = boardEl.querySelector('.mkj-check-indicator');
check('No check indicator on initial state', !checkIndicator);

// --- Test 3: _updatePieceVisual stale sprite fix ---
console.log('\n== Test 3: _updatePieceVisual stale sprite fix ==');

// Import BoardView and constants
const { BoardView } = await import('../src/board.js');
const { EMPTY, PAWN, QUEEN, KING } = await import('../src/chess-rules.js');

// Create a fresh board element for testing
const testBoardEl = doc.createElement('div');
testBoardEl.className = 'mkj-board';
doc.body.appendChild(testBoardEl);

const board = new BoardView(testBoardEl, {});
board.build();

// Set up a minimal position: white king e1, black king e8, white pawn on a8
const testBoardArr = new Int8Array(64).fill(EMPTY);
testBoardArr[4] = KING;    // e1 white king
testBoardArr[60] = -KING;  // e8 black king
testBoardArr[56] = PAWN;   // a8 white pawn (promoted)
board.setBoard(testBoardArr);

// Check the piece on a8
const a8Node = board.pieces[56];
check('Pawn on a8 has DOM node', !!a8Node);
if (a8Node) {
  const use1 = a8Node.querySelector('use');
  check('Pawn use href is #mkj-piece-wpawn', use1 && use1.getAttribute('href') === '#mkj-piece-wpawn',
    use1 ? use1.getAttribute('href') : 'no use');

  // Now change a8 to a queen (simulating redo of promotion)
  testBoardArr[56] = QUEEN;
  board.setBoard(testBoardArr);

  // The same DOM node should now have updated href
  const use2 = a8Node.querySelector('use');
  check('Queen use href is #mkj-piece-wqueen', use2 && use2.getAttribute('href') === '#mkj-piece-wqueen',
    use2 ? use2.getAttribute('href') : 'no use');
  check('use href was updated (not stale)', use2 && use2.getAttribute('href') !== '#mkj-piece-wpawn');
}

// Test undo scenario: queen on a8 -> pawn on a8
console.log('\n  Undo scenario:');
const b2Arr = new Int8Array(64).fill(EMPTY);
b2Arr[4] = KING;
b2Arr[60] = -KING;
b2Arr[56] = QUEEN; // queen on a8
board.setBoard(b2Arr);

const a8Node2 = board.pieces[56];
if (a8Node2) {
  const use3 = a8Node2.querySelector('use');
  check('Queen href is #mkj-piece-wqueen', use3 && use3.getAttribute('href') === '#mkj-piece-wqueen');

  // Undo: change back to pawn
  b2Arr[56] = PAWN;
  board.setBoard(b2Arr);

  const use4 = a8Node2.querySelector('use');
  check('After undo: pawn href is #mkj-piece-wpawn', use4 && use4.getAttribute('href') === '#mkj-piece-wpawn',
    use4 ? use4.getAttribute('href') : 'no use');
}

// --- Test 4: CSS piece SVG sizing ---
console.log('\n== Test 4: CSS piece SVG sizing ==');
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf-8');
check('CSS has .mkj-piece svg rule', css.includes('.mkj-piece svg'));
check('CSS has width/height 100% on piece svg', /.mkj-piece svg[^{]*\{[^}]*width:\s*100%/.test(css) || css.includes('.mkj-piece svg,\n.mkj-piece use'));
check('CSS has overflow visible on piece svg', css.includes('.mkj-piece svg { overflow: visible; }') || /.mkj-piece svg[^{]*\{[^}]*overflow:\s*visible/.test(css));

// --- Test 5: Piece DOM structure ---
console.log('\n== Test 5: Piece DOM structure ==');
if (pieces.length > 0) {
  const firstPiece = pieces[0];
  const svg = firstPiece.querySelector('svg');
  check('Piece has inner SVG', !!svg);
  if (svg) {
    check('SVG has viewBox', svg.getAttribute('viewBox') === '0 0 100 100');
    const use = svg.querySelector('use');
    check('SVG has use element', !!use);
    if (use) {
      check('use href starts with #mkj-piece-', use.getAttribute('href').startsWith('#mkj-piece-'));
    }
  }
}

// --- Summary ---
console.log(`\n================ RESULTS ================`);
console.log(`Pass: ${pass}, Fail: ${fail}`);
if (fail > 0) process.exit(1);
