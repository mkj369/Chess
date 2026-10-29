/**
 * MKJ Chess — Chess rules test-suite.
 * -----------------------------------------------------------------------------
 * Covers the full rules checklist: the starting position, every piece type,
 * illegal-move rejection, check handling, castling restrictions, en passant,
 * promotion, checkmate/stalemate, all draw types, undo/redo, and FEN/PGN.
 *
 * Run: npm test   (or: node --test tests/)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  WHITE,
  BLACK,
  EMPTY,
  PAWN,
  KNIGHT,
  BISHOP,
  ROOK,
  QUEEN,
  KING,
  FLAG,
  START_FEN,
  createPosition,
  createGame,
  gameFromFen,
  positionToFen,
  loadFen,
  validateFen,
  generateLegalMoves,
  generatePseudoLegalMoves,
  legalMoves,
  applyMove,
  undoMove,
  makeMove,
  unmakeMove,
  inCheck,
  isSquareAttacked,
  findKing,
  moveToSan,
  moveToUci,
  uciToMove,
  sanToMove,
  toPgn,
  parsePgn,
  gameStatus,
  STATUS,
  repetitionCount,
  materialInfo,
  hasInsufficientMaterial,
  squareName,
  squareIndex,
  positionKey,
  PIECE_VALUES,
  legalCaptures,
} from '../src/chess-rules.js';

/** Find a legal move by UCI. */
function move(game, uci) {
  const found = uciToMove(game.position, uci);
  assert.ok(found, `expected a legal move ${uci} in ${positionToFen(game.position)}`);
  return found;
}

/** Play a list of UCI moves, asserting each is legal. */
function play(game, uciList) {
  for (const uci of uciList) applyMove(game, move(game, uci));
}

/** Apply a UCI move directly to a position (for low-level tests). */
function playOnPosition(pos, uci) {
  const m = uciToMove(pos, uci);
  assert.ok(m, `expected a legal move ${uci} in ${positionToFen(pos)}`);
  return makeMove(pos, m);
}

/* ========================================================================== */

describe('Starting position', () => {
  it('is the standard position', () => {
    const pos = createPosition();
    assert.equal(positionToFen(pos), START_FEN);
  });

  it('has 32 pieces in the right places', () => {
    const pos = createPosition();
    let count = 0;
    for (let sq = 0; sq < 64; sq++) if (pos.board[sq] !== EMPTY) count++;
    assert.equal(count, 32);

    assert.equal(pos.board[squareIndex('a1')], ROOK);
    assert.equal(pos.board[squareIndex('b1')], KNIGHT);
    assert.equal(pos.board[squareIndex('c1')], BISHOP);
    assert.equal(pos.board[squareIndex('d1')], QUEEN);
    assert.equal(pos.board[squareIndex('e1')], KING);
    assert.equal(pos.board[squareIndex('f1')], BISHOP);
    assert.equal(pos.board[squareIndex('g1')], KNIGHT);
    assert.equal(pos.board[squareIndex('h1')], ROOK);

    assert.equal(pos.board[squareIndex('e8')], -KING);
    assert.equal(pos.board[squareIndex('d8')], -QUEEN);
    assert.equal(pos.board[squareIndex('a8')], -ROOK);
    assert.equal(pos.board[squareIndex('h8')], -ROOK);

    assert.equal(pos.board[squareIndex('a7')], -PAWN);
    assert.equal(pos.board[squareIndex('a2')], PAWN);
    assert.equal(pos.turn, WHITE);
  });

  it('has all four castling rights', () => {
    const pos = createPosition();
    assert.deepEqual(pos.castling, { K: true, Q: true, k: true, q: true });
  });

  it('starts with exactly 20 legal moves', () => {
    const game = createGame();
    assert.equal(legalMoves(game).length, 20);
  });

  it('generates 20 pseudo-legal moves from the start position', () => {
    const pos = createPosition();
    assert.equal(generatePseudoLegalMoves(pos).length, 20);
  });
});

describe('Piece movement', () => {
  it('a knight on g1 can reach f3, h3 and e2', () => {
    const pos = createPosition();
    const targets = legalMoves({ position: pos })
      .filter((m) => m.from === squareIndex('g1'))
      .map((m) => squareName(m.to))
      .sort();
    // e2 is occupied by White's own pawn, so only f3 and h3 are reachable.
    assert.deepEqual(targets, ['f3', 'h3']);
  });

  it('a pawn on a2 can advance one or two squares', () => {
    const pos = createPosition();
    const targets = legalMoves({ position: pos })
      .filter((m) => m.from === squareIndex('a2'))
      .map((m) => squareName(m.to))
      .sort();
    assert.deepEqual(targets, ['a3', 'a4']);
  });

  it('sliding pieces are blocked by friendly pieces', () => {
    const pos = createPosition();
    // The bishop on c1 is blocked by the d2 pawn.
    const c1 = squareIndex('c1');
    assert.equal(
      legalMoves({ position: pos }).filter((m) => m.from === c1).length,
      0,
    );
    // The rook on a1 is blocked by the b2 pawn.
    const a1 = squareIndex('a1');
    assert.equal(legalMoves({ position: pos }).filter((m) => m.from === a1).length, 0);
    // The queen on d1 is completely surrounded.
    assert.equal(legalMoves({ position: pos }).filter((m) => m.from === squareIndex('d1')).length, 0);
    // The king on e1 is surrounded.
    assert.equal(legalMoves({ position: pos }).filter((m) => m.from === squareIndex('e1')).length, 0);
  });

  it('a bishop moves diagonally', () => {
    const pos = createPosition('8/8/8/8/8/8/8/B6K w - - 0 1');
    const targets = legalMoves({ position: pos })
      .filter((m) => m.from === squareIndex('a1'))
      .map((m) => squareName(m.to))
      .sort();
    assert.deepEqual(targets, ['b2', 'c3', 'd4', 'e5', 'f6', 'g7', 'h8']);
  });

  it('a rook moves along ranks and files', () => {
    const pos = createPosition('8/8/8/8/8/8/8/R6K w - - 0 1');
    const targets = legalMoves({ position: pos })
      .filter((m) => m.from === squareIndex('a1'))
      .map((m) => squareName(m.to))
      .sort();
    assert.deepEqual(targets, ['a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1']);
  });

  it('a queen moves like a rook and a bishop combined', () => {
    const pos = createPosition('8/8/8/8/8/8/8/Q6K w - - 0 1');
    const targets = legalMoves({ position: pos })
      .filter((m) => m.from === squareIndex('a1'))
      .map((m) => squareName(m.to));
    // 6 along rank 1 (b1–g1; the king on g1 blocks h1), 7 up the a-file
    // and 7 along the long diagonal = 20.
    assert.equal(targets.length, 20);
    assert.ok(targets.includes('g1'));
    assert.ok(targets.includes('a8'));
    assert.ok(targets.includes('h8'));
  });

  it('a king moves one square in any direction', () => {
    const pos = createPosition('8/8/8/8/8/8/8/4K2k w - - 0 1');
    const targets = legalMoves({ position: pos })
      .filter((m) => m.from === squareIndex('e1'))
      .map((m) => squareName(m.to))
      .sort();
    assert.deepEqual(targets, ['d1', 'd2', 'e2', 'f1', 'f2']);
  });
});

describe('Illegal move rejection', () => {
  it('refuses to move onto a friendly piece', () => {
    const game = createGame();
    assert.throws(() => applyMove(game, { from: squareIndex('a1'), to: squareIndex('b1') }));
  });

  it('refuses a pawn capture onto an empty square', () => {
    const game = createGame();
    assert.throws(() => applyMove(game, { from: squareIndex('a2'), to: squareIndex('b3') }));
  });

  it('refuses a move that is not in the legal move list', () => {
    const game = createGame();
    assert.throws(() => applyMove(game, { from: squareIndex('a2'), to: squareIndex('a7') }));
  });

  it('refuses a move that would leave the king in check', () => {
    // White king on e1, black rook on e8 pinning the e-file.
    const pos = createPosition('4rk2/8/8/8/8/8/8/4K2R w K - 0 1');
    const kingMoves = legalMoves({ position: pos }).filter((m) => m.from === squareIndex('e1'));
    assert.deepEqual(kingMoves.map((m) => squareName(m.to)).sort(), ['d1', 'd2', 'f1', 'f2']);
    // e2 is occupied by nothing but is on the pinned file — it must be refused.
    assert.ok(!kingMoves.some((m) => m.to === squareIndex('e2')));
  });

  it('refuses a pinned piece move', () => {
    // White bishop on e2 pinned by the black rook on e8 against the king on e1.
    const pos = createPosition('4rk2/8/8/8/8/8/4B3/4K3 w - - 0 1');
    const bishopMoves = legalMoves({ position: pos }).filter((m) => m.from === squareIndex('e2'));
    assert.equal(bishopMoves.length, 0, 'a fully pinned bishop cannot move');
  });

  it('refuses an en-passant capture that would expose the king', () => {
    // White king on d4, white pawn on d5, black pawn just played e7-e5, black
    // rook on d8. d5xe6 removes the d-pawn and opens the file to the king.
    const pos = createPosition('3r2k1/8/8/3Pp3/8/8/3K4/8 w - e6 0 1');
    assert.ok(!inCheck(pos), 'white is not in check before the move');
    const ep = legalMoves({ position: pos }).find((m) => m.flags & FLAG.EP_CAPTURE);
    assert.equal(ep, undefined, 'en passant must be refused when it exposes the king');
  });
});

describe('Check', () => {
  it('detects a simple check', () => {
    const pos = createPosition('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1');
    playOnPosition(pos, 'a1a8');
    assert.ok(inCheck(pos), 'the black king on e8 is in check from the rook on a8');
  });

  it('detects checks from knights, bishops, queens and pawns', () => {
    const cases = [
      { fen: '8/8/8/4k3/8/5N2/8/4K3 b - - 0 1', why: 'a knight on f3 checks the king on e5' },
      { fen: '7B/8/8/8/3k4/8/8/4K3 b - - 0 1', why: 'a bishop on h8 checks the king on d4' },
      { fen: '8/8/8/4k3/3P4/8/8/4K3 b - - 0 1', why: 'a pawn on d4 checks the king on e5' },
      { fen: '8/8/8/4k3/8/8/8/Q3K3 b - - 0 1', why: 'a queen on a1 checks along the a1-e5 diagonal' },
      { fen: '8/8/8/R3k3/8/8/8/4K3 b - - 0 1', why: 'a rook on a5 checks along the fifth rank' },
    ];
    for (const c of cases) {
      const pos = createPosition(c.fen);
      assert.ok(inCheck(pos), `${c.why} — ${c.fen}`);
    }
  });

  it('reports no check when nothing attacks the king', () => {
    const pos = createPosition('8/8/8/4k3/8/8/8/4K3 w - - 0 1');
    assert.equal(inCheck(pos), false);
  });

  it('finds the king square', () => {
    const pos = createPosition();
    assert.equal(findKing(pos, WHITE), squareIndex('e1'));
    assert.equal(findKing(pos, BLACK), squareIndex('e8'));
  });
});

describe('Castling', () => {
  it('allows kingside castling with a clear path', () => {
    const pos = createPosition('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const castle = legalMoves({ position: pos }).find((m) => m.flags & FLAG.CASTLE_KS);
    assert.ok(castle, 'kingside castling should be legal');
    assert.equal(castle.to, squareIndex('g1'));
  });

  it('allows queenside castling with a clear path', () => {
    const pos = createPosition('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const castle = legalMoves({ position: pos }).find((m) => m.flags & FLAG.CASTLE_QS);
    assert.ok(castle, 'queenside castling should be legal');
    assert.equal(castle.to, squareIndex('c1'));
  });

  it('refuses castling while in check', () => {
    const pos = createPosition('r3k2r/8/8/8/8/8/4r3/R3K2R w KQkq - 0 1');
    assert.ok(inCheck(pos), 'the king is in check from the rook on e2');
    assert.equal(
      legalMoves({ position: pos }).filter((m) => m.flags & (FLAG.CASTLE_KS | FLAG.CASTLE_QS)).length,
      0,
      'castling out of check is illegal',
    );
  });

  it('refuses castling through an attacked square', () => {
    // The rook on f2 attacks f1, which the king must pass through.
    const pos = createPosition('r3k2r/8/8/8/8/8/5r2/R3K2R w KQkq - 0 1');
    const kingside = legalMoves({ position: pos }).find((m) => m.flags & FLAG.CASTLE_KS);
    assert.equal(kingside, undefined, 'kingside castling through f1 is illegal');
    // Queenside is still fine: the king passes through d1, which is not attacked.
    const queenside = legalMoves({ position: pos }).find((m) => m.flags & FLAG.CASTLE_QS);
    assert.ok(queenside, 'queenside castling is still legal');
  });

  it('refuses castling to a square that is attacked', () => {
    // The rook on g2 attacks g1, the king's destination.
    const pos = createPosition('r3k2r/8/8/8/8/8/6r1/R3K2R w KQkq - 0 1');
    const kingside = legalMoves({ position: pos }).find((m) => m.flags & FLAG.CASTLE_KS);
    assert.equal(kingside, undefined, 'kingside castling onto an attacked square is illegal');
  });

  it('refuses queenside castling when the squares are blocked', () => {
    const pos = createPosition('r3k2r/8/8/8/8/8/8/R1B1KB1R w KQkq - 0 1');
    assert.equal(
      legalMoves({ position: pos }).filter((m) => m.flags & FLAG.CASTLE_QS).length,
      0,
      'a piece on b1 blocks queenside castling',
    );
  });

  it('moves the rook as well as the king', () => {
    const pos = createPosition('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    playOnPosition(pos, 'e1g1');
    assert.equal(pos.board[squareIndex('g1')], KING);
    assert.equal(pos.board[squareIndex('f1')], ROOK);
    assert.equal(pos.board[squareIndex('h1')], EMPTY);
    assert.equal(pos.board[squareIndex('e1')], EMPTY);
  });

  it('moves the rook the right way on queenside castling', () => {
    const pos = createPosition('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    playOnPosition(pos, 'e1c1');
    assert.equal(pos.board[squareIndex('c1')], KING);
    assert.equal(pos.board[squareIndex('d1')], ROOK);
    assert.equal(pos.board[squareIndex('a1')], EMPTY);
  });

  it('removes castling rights for both sides after castling', () => {
    const pos = createPosition('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    playOnPosition(pos, 'e1g1');
    assert.equal(pos.castling.K, false);
    assert.equal(pos.castling.Q, false);
  });

  it('loses castling rights when the king moves', () => {
    const pos = createPosition('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    playOnPosition(pos, 'e1f1');
    assert.equal(pos.castling.K, false);
    assert.equal(pos.castling.Q, false);
  });

  it('loses castling rights when a rook moves', () => {
    const pos = createPosition('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    playOnPosition(pos, 'a1a2');
    assert.equal(pos.castling.Q, false, 'queenside rights are gone');
    assert.equal(pos.castling.K, true, 'kingside rights survive');
  });

  it('loses castling rights when a rook is captured', () => {
    const pos = createPosition('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    playOnPosition(pos, 'e1e2');
    // Black rook on a8 captures the white rook on a1.
    playOnPosition(pos, 'a8a1');
    assert.equal(pos.castling.Q, false);
  });

  it('works for black as well', () => {
    const pos = createPosition('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1');
    playOnPosition(pos, 'e8g8');
    assert.equal(pos.board[squareIndex('g8')], -KING);
    assert.equal(pos.board[squareIndex('f8')], -ROOK);
    assert.equal(pos.board[squareIndex('h8')], EMPTY);
  });
});

describe('En passant', () => {
  it('allows an en-passant capture', () => {
    const pos = createPosition('rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3');
    const ep = legalMoves({ position: pos }).find((m) => m.flags & FLAG.EP_CAPTURE);
    assert.ok(ep, 'exd6 en passant should be legal');
    assert.equal(ep.from, squareIndex('e5'));
    assert.equal(ep.to, squareIndex('d6'));
    assert.equal(ep.captured, -PAWN);
  });

  it('removes the captured pawn from its own square', () => {
    const pos = createPosition('rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3');
    playOnPosition(pos, 'e5d6');
    assert.equal(pos.board[squareIndex('d6')], PAWN, 'the white pawn lands on d6');
    assert.equal(pos.board[squareIndex('d5')], EMPTY, 'the black pawn on d5 is gone');
    assert.equal(pos.ep, -1, 'the en-passant right is consumed');
  });

  it('expires after a move that does not use it', () => {
    const pos = createPosition('rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3');
    assert.equal(pos.ep, squareIndex('d6'));
    playOnPosition(pos, 'g2g3');
    assert.equal(pos.ep, -1, 'the en-passant target is cleared');
  });

  it('is not offered when no pawn can capture', () => {
    const pos = createPosition('4k3/8/8/8/8/8/8/R3K3 w - e3 0 1');
    assert.equal(pos.ep, -1, 'an unreachable en-passant square is dropped on load');
  });

  it('a double pawn push sets the en-passant target', () => {
    const pos = createPosition('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1');
    playOnPosition(pos, 'e2e4');
    assert.equal(pos.ep, squareIndex('e3'));
  });
});

describe('Promotion', () => {
  const promoFen = '8/P6k/8/8/8/8/7K/8 w - - 0 1';

  it('offers all four promotion choices', () => {
    const pos = createPosition(promoFen);
    const promos = legalMoves({ position: pos })
      .filter((m) => m.flags & FLAG.PROMOTION)
      .map((m) => m.promotion)
      .sort((a, b) => a - b);
    assert.deepEqual(promos, [KNIGHT, BISHOP, ROOK, QUEEN]);
  });

  it('promotes to a queen', () => {
    const pos = createPosition(promoFen);
    playOnPosition(pos, 'a7a8q');
    assert.equal(pos.board[squareIndex('a8')], QUEEN);
  });

  it('promotes to a rook', () => {
    const pos = createPosition(promoFen);
    playOnPosition(pos, 'a7a8r');
    assert.equal(pos.board[squareIndex('a8')], ROOK);
  });

  it('promotes to a bishop', () => {
    const pos = createPosition(promoFen);
    playOnPosition(pos, 'a7a8b');
    assert.equal(pos.board[squareIndex('a8')], BISHOP);
  });

  it('promotes to a knight', () => {
    const pos = createPosition(promoFen);
    playOnPosition(pos, 'a7a8n');
    assert.equal(pos.board[squareIndex('a8')], KNIGHT);
  });

  it('uses SAN with the = suffix', () => {
    const game = createGame(promoFen);
    applyMove(game, move(game, 'a7a8q'));
    assert.equal(game.history[0].san, 'a8=Q');
  });

  it('works for black as well', () => {
    const pos = createPosition('k7/8/8/8/8/8/p7/2K5 b - - 0 1');
    const promos = legalMoves({ position: pos }).filter((m) => m.flags & FLAG.PROMOTION);
    assert.equal(promos.length, 4);
    playOnPosition(pos, 'a2a1q');
    assert.equal(pos.board[squareIndex('a1')], -QUEEN);
  });
});

describe('Checkmate and stalemate', () => {
  it('detects fool\'s mate', () => {
    const game = createGame('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
    const status = gameStatus(game);
    assert.equal(status.over, true);
    assert.equal(status.status, STATUS.CHECKMATE);
    assert.equal(status.winner, BLACK);
  });

  it('detects a back-rank checkmate', () => {
    const game = createGame('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1');
    applyMove(game, move(game, 'a1a8'));
    const status = gameStatus(game);
    assert.equal(status.over, true);
    assert.equal(status.status, STATUS.CHECKMATE);
    assert.equal(status.winner, WHITE);
  });

  it('detects stalemate', () => {
    const game = createGame('7k/5K2/5N2/8/8/8/8/8 b - - 0 1');
    const status = gameStatus(game);
    assert.equal(status.over, true);
    assert.equal(status.status, STATUS.STALEMATE);
    assert.equal(status.winner, null);
    assert.equal(status.description.includes('Stalemate'), true);
  });

  it('does not call a position with legal moves a mate', () => {
    const game = createGame();
    const status = gameStatus(game);
    assert.equal(status.over, false);
  });

  it('detects check without ending the game when replies exist', () => {
    const pos = createPosition('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1');
    playOnPosition(pos, 'a1a8');
    assert.ok(inCheck(pos));
    const game = { position: pos, history: [], keys: [positionKey(pos)] };
    const status = gameStatus(game);
    assert.equal(status.over, false);
    assert.equal(status.check, true);
  });
});

describe('Draws', () => {
  it('king versus king is insufficient material', () => {
    const pos = createPosition('8/8/8/8/8/8/8/4K2k w - - 0 1');
    assert.ok(hasInsufficientMaterial(pos));
  });

  it('king and minor versus king is insufficient material', () => {
    const pos = createPosition('8/8/8/8/8/8/4K2b/4k3 w - - 0 1');
    assert.ok(hasInsufficientMaterial(pos), 'K+B vs K cannot deliver mate');
    const knight = createPosition('8/8/8/8/8/8/4K2n/4k3 w - - 0 1');
    assert.ok(hasInsufficientMaterial(knight), 'K+N vs K cannot deliver mate');
  });

  it('two same-coloured bishops versus a king is insufficient material', () => {
    const pos = createPosition('8/8/8/8/8/2B5/1b6/4K2k w - - 0 1');
    assert.ok(hasInsufficientMaterial(pos));
  });

  it('a rook versus a king is NOT insufficient material', () => {
    const pos = createPosition('8/8/8/8/8/8/8/R3K2k w - - 0 1');
    assert.equal(hasInsufficientMaterial(pos), false);
  });

  it('detects threefold repetition', () => {
    const game = createGame();
    // Repeat Nf3/Nf6/Ng1/Ng8 until the start position appears three times.
    const sequence = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
    let guard = 0;
    while (repetitionCount(game) < 3 && guard++ < 20) {
      for (const uci of sequence) applyMove(game, move(game, uci));
    }
    assert.equal(repetitionCount(game), 3, 'the start position recurs three times');
    const status = gameStatus(game);
    assert.equal(status.over, true);
    assert.equal(status.status, STATUS.THREEFOLD);
  });

  it('counts repetitions across the whole game', () => {
    const game = createGame();
    const sequence = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
    for (const uci of sequence) applyMove(game, move(game, uci));
    assert.equal(repetitionCount(game), 2, 'one repeat so far');
    for (const uci of sequence) applyMove(game, move(game, uci));
    assert.equal(repetitionCount(game), 3);
  });

  it('detects the fifty-move rule as claimable', () => {
    const game = createGame('4k3/8/8/8/8/8/8/R3K2R w KQ - 100 1');
    const status = gameStatus(game, { autoFifty: false });
    assert.equal(status.over, false, 'the 50-move rule is claimable, not automatic');
    const claim = gameStatus(game, { autoFifty: true });
    assert.equal(claim.over, true);
    assert.equal(claim.status, STATUS.FIFTY_MOVE);
  });

  it('applies the seventy-five-move rule automatically', () => {
    const game = createGame('4k3/8/8/8/8/8/8/R3K2R w KQ - 150 1');
    const status = gameStatus(game);
    assert.equal(status.over, true);
    assert.equal(status.status, STATUS.SEVENTY_FIVE_MOVE);
  });

  it('does not claim the fifty-move rule before 100 half-moves', () => {
    const game = createGame('4k3/8/8/8/8/8/8/R3K2R w KQ - 99 1');
    assert.equal(gameStatus(game, { autoFifty: true }).over, false);
  });

  it('detects insufficient material as a game end', () => {
    const game = createGame('8/8/8/8/8/8/8/4K2k w - - 0 1');
    const status = gameStatus(game);
    assert.equal(status.over, true);
    assert.equal(status.status, STATUS.INSUFFICIENT_MATERIAL);
  });
});

describe('Undo and redo', () => {
  it('undo restores the exact previous FEN', () => {
    const game = createGame();
    const before = positionToFen(game.position);
    play(game, ['e2e4', 'e7e5']);
    assert.notEqual(positionToFen(game.position), before);
    undoMove(game);
    assert.notEqual(positionToFen(game.position), before, 'one undo is not enough');
    undoMove(game);
    assert.equal(positionToFen(game.position), before, 'two undos return to the start');
  });

  it('undo restores castling rights and en-passant state', () => {
    const game = createGame();
    play(game, ['e2e4']);
    const afterDouble = positionToFen(game.position);
    assert.ok(afterDouble.includes('e3'), 'the en-passant target is set');
    undoMove(game);
    const restored = positionToFen(game.position);
    assert.equal(restored, START_FEN);
    assert.ok(restored.includes('KQkq'));
  });

  it('undo restores material after a capture', () => {
    const game = createGame('rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3');
    play(game, ['e5d6']);
    const after = materialInfo(game);
    assert.equal(after.capturedBlack.length, 1);
    undoMove(game);
    const before = materialInfo(game);
    assert.equal(before.capturedBlack.length, 0);
  });

  it('undo restores promotion', () => {
    const game = createGame('8/P6k/8/8/8/8/7K/8 w - - 0 1');
    play(game, ['a7a8q']);
    assert.equal(game.position.board[squareIndex('a8')], QUEEN);
    undoMove(game);
    assert.equal(game.position.board[squareIndex('a8')], EMPTY);
    assert.equal(game.position.board[squareIndex('a7')], PAWN);
  });

  it('undo restores castling', () => {
    const game = createGame('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    play(game, ['e1g1']);
    undoMove(game);
    assert.equal(game.position.board[squareIndex('e1')], KING);
    assert.equal(game.position.board[squareIndex('h1')], ROOK);
    assert.equal(game.position.board[squareIndex('f1')], EMPTY);
    assert.equal(game.position.castling.K, true);
  });

  it('undo on an empty history returns null', () => {
    const game = createGame();
    assert.equal(undoMove(game), null);
  });

  it('a replayed game after undo still validates moves', () => {
    const game = createGame();
    play(game, ['e2e4', 'e7e5', 'g1f3']);
    assert.equal(game.history.length, 3);
    undoMove(game);
    undoMove(game);
    assert.equal(game.history.length, 1, 'two undos leave one ply played');
    // The remaining position is still playable, and the same moves validate.
    play(game, ['e7e5', 'g1f3']);
    assert.equal(game.history.length, 3);
    assert.equal(game.position.turn, BLACK);
  });
});

describe('Notation', () => {
  it('produces SAN for the opening moves', () => {
    const game = createGame();
    play(game, ['e2e4', 'e7e5', 'g1f3', 'b8c6']);
    assert.deepEqual(game.history.map((h) => h.san), ['e4', 'e5', 'Nf3', 'Nc6']);
  });

  it('marks captures with x', () => {
    const game = createGame('rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3');
    applyMove(game, move(game, 'e5d6'));
    assert.equal(game.history[0].san, 'exd6');
  });

  it('marks checks and mates', () => {
    const game = createGame('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1');
    applyMove(game, move(game, 'a1a8'));
    assert.equal(game.history[0].san, 'Ra8#');
  });

  it('disambiguates moves from two identical pieces', () => {
    const game = createGame('3k4/8/8/8/8/8/3N1N2/4K3 w - - 0 1');
    applyMove(game, move(game, 'd2e4'));
    assert.equal(game.history[0].san, 'Nde4', 'the file disambiguates two knights on the same rank');
  });

  it('uses file disambiguation when needed', () => {
    const game = createGame('7k/8/8/8/8/8/8/R2R1K2 w - - 0 1');
    applyMove(game, move(game, 'a1c1'));
    assert.equal(game.history[0].san, 'Rac1', 'the file disambiguates two rooks on the same rank');
  });

  it('uses rank disambiguation when needed', () => {
    // Black king on a8 so the c6 knight does not already give check.
    const game = createGame('k7/8/2N5/8/8/8/2N5/4K3 w - - 0 1');
    applyMove(game, move(game, 'c2b4'));
    assert.equal(game.history[0].san, 'N2b4', 'the rank disambiguates two knights on the same file');
  });

  it('notates castling', () => {
    // Kingside and queenside are tested in separate games: after one side
    // castles, its rook attacks the other side's kingside path, making the
    // second castle illegal in a single game.
    const kingside = createGame('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    applyMove(kingside, move(kingside, 'e1g1'));
    assert.equal(kingside.history[0].san, 'O-O');

    const queenside = createGame('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    applyMove(queenside, move(queenside, 'e1c1'));
    assert.equal(queenside.history[0].san, 'O-O-O');
  });

  it('notates promotions', () => {
    const game = createGame('8/P6k/8/8/8/8/7K/8 w - - 0 1');
    applyMove(game, move(game, 'a7a8q'));
    assert.equal(game.history[0].san, 'a8=Q');
  });

  it('round-trips SAN back to a legal move', () => {
    const game = createGame();
    const san = 'Nf3';
    const resolved = sanToMove(game.position, san);
    assert.ok(resolved, `${san} should resolve`);
    assert.equal(moveToUci(resolved), 'g1f3');
  });

  it('round-trips UCI for every start-position move', () => {
    const pos = createPosition();
    for (const m of generateLegalMoves(pos)) {
      const back = uciToMove(pos, moveToUci(m));
      assert.ok(back, `${moveToUci(m)} should round-trip`);
      assert.equal(back.from, m.from);
      assert.equal(back.to, m.to);
    }
  });

  it('rejects malformed UCI', () => {
    const pos = createPosition();
    assert.equal(uciToMove(pos, ''), null);
    assert.equal(uciToMove(pos, 'a1'), null);
    assert.equal(uciToMove(pos, 'zzzz'), null);
    assert.equal(uciToMove(pos, 'a9b9'), null);
  });
});

describe('FEN', () => {
  it('round-trips the starting position', () => {
    const pos = createPosition();
    assert.equal(positionToFen(pos), START_FEN);
  });

  it('round-trips an arbitrary position', () => {
    const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 6 3';
    const pos = createPosition(fen);
    assert.equal(positionToFen(pos), fen);
  });

  it('rejects a malformed board', () => {
    const bad = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN w KQkq - 0 1';
    assert.equal(validateFen(bad).ok, false);
  });

  it('rejects an invalid turn field', () => {
    assert.equal(validateFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1').ok, false);
  });

  it('rejects an invalid castling field', () => {
    assert.equal(validateFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w Kzq - 0 1').ok, false);
  });

  it('rejects an invalid en-passant square', () => {
    assert.equal(validateFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq i9 0 1').ok, false);
  });

  it('rejects a position with two kings on one side', () => {
    assert.equal(validateFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNRK w KQkq - 0 1').ok, false);
  });

  it('rejects a position with no king', () => {
    assert.equal(validateFen('r3k2r/8/8/8/8/8/8/R3Q3 w KQ - 0 1').ok, false);
  });

  it('rejects a pawn on the first rank', () => {
    assert.equal(validateFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/PnBQKBNR w KQkq - 0 1').ok, false);
  });

  it('rejects a rank that covers the wrong number of squares', () => {
    assert.equal(validateFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPPP/RNBQKBNR w KQkq - 0 1').ok, false);
  });

  it('throws when loading an invalid FEN', () => {
    assert.throws(() => createPosition('not a fen'));
  });

  it('clears castling rights that the board does not support', () => {
    // Rights are kept when the king and rooks are on their home squares.
    const pos2 = createPosition('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    assert.equal(pos2.castling.Q, true);
    assert.equal(pos2.castling.K, true);
    // Rights are cleared when the rook has left its home square. A temporarily
    // blocked path does not remove the right — only king/rook movement does.
    const pos3 = createPosition('r3k2r/8/8/8/8/8/8/4K2R w KQkq - 0 1');
    assert.equal(pos3.castling.Q, false, 'rights are removed when the a1 rook is gone');
    assert.equal(pos3.castling.K, true);
  });

  it('drops an unreachable en-passant square', () => {
    const pos = createPosition('4k3/8/8/8/8/8/8/R3K3 w - e3 0 1');
    assert.equal(pos.ep, -1);
  });

  it('preserves the halfmove and fullmove counters', () => {
    const pos = createPosition('4k3/8/8/8/8/8/8/R3K2R w KQ - 5 12');
    assert.equal(pos.halfmove, 5);
    assert.equal(pos.fullmove, 12);
  });
});

describe('PGN', () => {
  it('exports a game with headers and moves', () => {
    const game = createGame();
    play(game, ['e2e4', 'e7e5', 'g1f3']);
    const pgn = toPgn(game);
    assert.match(pgn, /\[Event "MKJ Chess game"\]/);
    assert.match(pgn, /\[White "White"\]/);
    assert.match(pgn, /\[Black "Black"\]/);
    assert.match(pgn, /1\. e4 e5/);
    assert.match(pgn, /2\. Nf3/);
    assert.match(pgn, /\*\s*$/);
  });

  it('records a checkmate result', () => {
    const game = createGame('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1');
    applyMove(game, move(game, 'a1a8'));
    const pgn = toPgn(game);
    assert.match(pgn, /\[Result "1-0"\]/);
  });

  it('records a draw result', () => {
    // King vs king is insufficient material, so the game is a draw.
    const game = createGame('k7/8/1K6/8/8/8/8/8 w - - 0 1');
    const pgn = toPgn(game);
    assert.match(pgn, /\[Result "1\/2-1\/2"\]/);
  });

  it('round-trips a game through export and import', () => {
    const game = createGame();
    play(game, ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6']);
    const pgn = toPgn(game);
    const parsed = parsePgn(pgn);
    assert.equal(parsed.ok, true, parsed.error);
    assert.equal(parsed.game.history.length, 6);
    assert.deepEqual(
      parsed.game.history.map((h) => h.san),
      game.history.map((h) => h.san),
    );
    assert.equal(positionToFen(parsed.game.position), positionToFen(game.position));
  });

  it('imports a well-formed external PGN', () => {
    const pgn = [
      '[Event "Test"]',
      '[Site "MKJ Chess"]',
      '[Date "2026.01.01"]',
      '[Round "1"]',
      '[White "Alice"]',
      '[Black "Bob"]',
      '[Result "1-0"]',
      '',
      '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0',
      '',
    ].join('\n');
    const parsed = parsePgn(pgn);
    assert.equal(parsed.ok, true, parsed.error);
    assert.equal(parsed.game.history.length, 6);
    assert.equal(parsed.headers.White, 'Alice');
    assert.equal(parsed.headers.Black, 'Bob');
  });

  it('reports an illegal move with its number', () => {
    const pgn = '[Event "Test"] [White "A"] [Black "B"] [Result "*"]\n\n1. e4 e5 2. Qh5?? 1. e4\n*';
    const parsed = parsePgn(pgn);
    // "Qh5" may be legal here, so instead force an obviously illegal move:
    // Kf2 is blocked by White's own pawn on f2.
    const bad = '[Event "Test"] [White "A"] [Black "B"] [Result "*"]\n\n1. e4 e5 2. Kf2\n*';
    const parsed2 = parsePgn(bad);
    assert.equal(parsed2.ok, false, 'Kf2 on move 2 is not legal');
    assert.match(parsed2.error, /move 2/);
    void parsed;
  });

  it('rejects an empty PGN', () => {
    assert.equal(parsePgn('').ok, false);
    assert.equal(parsePgn('   \n').ok, false);
  });

  it('rejects a PGN with an invalid start FEN', () => {
    const bad = '[Event "Test"] [FEN "not a fen"] [White "A"] [Black "B"]\n\n1. e4\n*';
    const parsed = parsePgn(bad);
    assert.equal(parsed.ok, false);
  });

  it('ignores comments, variations and NAGs', () => {
    const pgn = [
      '[Event "Test"] [White "A"] [Black "B"] [Result "*"]',
      '',
      '1. e4 {good move} e5 2. Nf3 (2. Bc4 {another line} d6) Nc6 3. Bb5 $1 a6 *',
    ].join('\n');
    const parsed = parsePgn(pgn);
    assert.equal(parsed.ok, true, parsed.error);
    assert.equal(parsed.game.history.length, 6);
  });

  it('handles a game that starts with Black', () => {
    const pgn = '[Event "Test"] [FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1"] [White "A"] [Black "B"] [Result "*"]\n\n1... e5 2. Nf3\n*';
    const parsed = parsePgn(pgn);
    assert.equal(parsed.ok, true, parsed.error);
    assert.equal(parsed.game.history.length, 2);
    assert.equal(parsed.game.history[0].san, 'e5');
  });
});

describe('Material and captures', () => {
  it('tracks captured pieces through the history', () => {
    const game = createGame('rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3');
    play(game, ['e5d6']);
    const info = materialInfo(game);
    assert.deepEqual(info.capturedBlack, [PAWN]);
    assert.equal(info.balance, PIECE_VALUES[PAWN]);
  });

  it('computes material advantage from the captured-piece lists', () => {
    const game = createGame();
    assert.equal(materialInfo(game).balance, 0);
  });
});

describe('Move ordering helpers', () => {
  it('lists only legal moves from a square', () => {
    const pos = createPosition();
    // The knight on g1 can reach f3 and h3 (e2 is blocked by White's pawn).
    const fromG1 = generateLegalMoves(pos).filter((m) => m.from === squareIndex('g1'));
    assert.equal(fromG1.length, 2);
  });

  it('generates captures only when asked', () => {
    const pos = createPosition('rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3');
    const all = generateLegalMoves(pos);
    const caps = legalCaptures(pos);
    assert.equal(caps.length, 1, 'only the en-passant capture is available');
    assert.ok(caps.length < all.length);
  });
});

describe('makeMove / unmakeMove symmetry', () => {
  it('restore an exact position after a complex move', () => {
    const fen = 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1';
    for (const uci of ['a7b8q', 'b8a7', 'a2a4', 'q1a1']) {
      const pos = createPosition(fen);
      const m = uciToMove(pos, uci);
      if (!m) continue;
      const before = positionToFen(pos);
      const undo = makeMove(pos, m);
      assert.notEqual(positionToFen(pos), before);
      unmakeMove(pos, m, undo);
      assert.equal(positionToFen(pos), before, `${uci} must round-trip`);
    }
  });

  it('restores castling rights after a rook move', () => {
    const pos = createPosition('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const before = { ...pos.castling };
    const m = uciToMove(pos, 'a1a2');
    const undo = makeMove(pos, m);
    unmakeMove(pos, m, undo);
    assert.deepEqual(pos.castling, before);
  });
});

describe('applyMove return value (regression — must return the history entry)', () => {
  it('returns an entry with move, san, undo and capturedPiece', () => {
    const game = createGame();
    const move = legalMoves(game)[0];
    const entry = applyMove(game, move);
    assert.ok(entry, 'applyMove must return an entry object');
    assert.equal(entry.move.from, move.from, 'entry.move must be the applied move');
    assert.equal(entry.move.to, move.to);
    assert.equal(typeof entry.san, 'string', 'entry.san must be a SAN string');
    assert.ok(entry.undo, 'entry.undo must be present');
    assert.ok('capturedPiece' in entry, 'entry.capturedPiece must exist');
    assert.equal(game.history.length, 1);
    assert.equal(game.history[0], entry, 'the returned entry must be the one pushed to history');
  });

  it('reports a non-zero capturedPiece on a capture', () => {
    const game = createGame('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1');
    const ep = legalMoves(game).find((m) => m.from === 28 && m.to === 35);
    assert.ok(ep, 'exd5 capture must be legal');
    const entry = applyMove(game, ep);
    assert.ok(entry.capturedPiece, 'capturedPiece must be non-zero on a capture');
  });
});
