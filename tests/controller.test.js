/**
 * MKJ Chess — controller / board integration tests (jsdom).
 *
 * Boots the real BoardView + GameController inside a jsdom DOM to catch
 * regressions that pure-engine tests cannot see:
 *   - canUndo() must not throw before a game exists
 *   - pieces render with the correct colour-aware sprite symbol ids
 *   - the last-move highlight appears after a move
 *   - the check indicator lands on the checked king
 *   - a capture animates the captured piece off the board
 *
 * Run: npm test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="board"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
try {
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
} catch { /* Node's navigator is fine */ }
globalThis.location = window.location;
globalThis.localStorage = window.localStorage;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.Event = window.Event;

const { BoardView } = await import('../src/board.js');
const { GameController } = await import('../src/game.js');
const { SoundEngine } = await import('../src/sound.js');

function makeController(fen) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const board = new BoardView(el, {});
  board.build();
  const sound = new SoundEngine();
  const c = new GameController({
    board,
    sound,
    settings: { showCoordinates: false, showLegalMoves: true, pieceAnimations: true, defaultDifficulty: 'easy', autoFifty: true },
    onPromotion: async () => ({ promotion: 'q' }),
  });
  c.start({ mode: 'local', fen: fen || undefined });
  return { c, board, el };
}

describe('controller — pre-game safety', () => {
  it('canUndo() returns false without throwing when no game has started', () => {
    const el = document.createElement('div');
    const board = new BoardView(el, {});
    const c = new GameController({ board, sound: new SoundEngine(), settings: {} });
    assert.equal(c.canUndo(), false);
    assert.equal(c.canRedo(), false);
  });
});

describe('controller — piece symbol rendering', () => {
  it('renders all 32 pieces with colour-aware mkj-piece-* symbol ids', () => {
    const { board } = makeController();
    const uses = board.el.querySelectorAll('use[href^="#mkj-piece-"]');
    assert.equal(uses.length, 32);
    // No numeric symbol ids (e.g. "#mkj-piece-w5") — must use piece names.
    for (const u of uses) {
      const href = u.getAttribute('href');
      assert.match(href, /^#mkj-piece-[wb](pawn|rook|knight|bishop|queen|king)$/, `bad symbol id: ${href}`);
    }
  });
});

describe('controller — last-move & check highlights', () => {
  it('shows the last-move highlight on both squares after a move', () => {
    const { c, board } = makeController();
    c.handleSquareClick(12); // e2
    c.handleSquareClick(28); // e4
    const e2 = board.el.querySelector('.mkj-sq[data-sq="12"]');
    const e4 = board.el.querySelector('.mkj-sq[data-sq="28"]');
    assert.ok(e2.classList.contains('is-last'), 'e2 should have is-last');
    assert.ok(e4.classList.contains('is-last'), 'e4 should have is-last');
  });

  it('marks the checked king square after Ra8#', () => {
    const { c, board } = makeController('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
    c.handleSquareClick(0);  // a1 rook
    c.handleSquareClick(56); // a8
    assert.equal(c.over, true);
    assert.equal(c.result, '1-0');
    const g8 = board.el.querySelector('.mkj-sq[data-sq="62"]');
    assert.ok(g8.classList.contains('mkj-sq--check'), 'g8 king should show check indicator');
  });
});

describe('controller — capture animation', () => {
  it('removes the captured piece from the pieces map after a capture', () => {
    const { c, board } = makeController();
    c.handleSquareClick(12); c.handleSquareClick(28); // e2-e4
    c.handleSquareClick(51); c.handleSquareClick(35); // d7-d5
    c.handleSquareClick(28); c.handleSquareClick(35); // e4xd5
    assert.equal(Object.keys(board.pieces).length, 31, 'captured piece should be removed from the map');
    assert.ok(board.board[35] > 0, 'capturing pawn should be on d5');
  });
});
