/**
 * MKJ Chess — Chess Rules Engine
 * -----------------------------------------------------------------------------
 * Complete, dependency-free implementation of standard chess rules.
 *
 * Guarantees:
 *   - Full legal move generation for all six piece types.
 *   - Castling (both sides, with every restriction), en passant, promotion.
 *   - No move that leaves the mover's own king in check is ever returned.
 *   - Check, checkmate, stalemate, and all four draw types.
 *   - FEN / SAN / UCI conversion, PGN export and import.
 *
 * Board representation: a 64-element Int8Array, index 0 = a1 ... index 63 = h8.
 * index = rank * 8 + file, where rank 0 is White's first rank.
 *
 * Piece codes: positive = White, negative = Black, 0 = empty.
 *   1 Pawn, 2 Knight, 3 Bishop, 4 Rook, 5 Queen, 6 King
 *
 * This module is a pure ES module and runs identically in the browser and in
 * Node (used by the automated test-suite in /tests).
 */

/* ========================================================================== */
/* Constants                                                                   */
/* ========================================================================== */

export const WHITE = 'w';
export const BLACK = 'b';

export const EMPTY = 0;
export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

export const PIECE_NAMES = {
  [PAWN]: 'Pawn',
  [KNIGHT]: 'Knight',
  [BISHOP]: 'Bishop',
  [ROOK]: 'Rook',
  [QUEEN]: 'Queen',
  [KING]: 'King',
};

export const PIECE_LETTERS = {
  [PAWN]: 'p',
  [KNIGHT]: 'n',
  [BISHOP]: 'b',
  [ROOK]: 'r',
  [QUEEN]: 'q',
  [KING]: 'k',
};

export const LETTER_TO_PIECE = {
  p: PAWN,
  n: KNIGHT,
  b: BISHOP,
  r: ROOK,
  q: QUEEN,
  k: KING,
};

/** Move flag bitmask. */
export const FLAG = {
  NORMAL: 0,
  CAPTURE: 1,
  DOUBLE_PAWN: 2,
  EP_CAPTURE: 4,
  CASTLE_KS: 8,
  CASTLE_QS: 16,
  PROMOTION: 32,
};

export const START_FEN =
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/* ========================================================================== */
/* Pre-computed geometry                                                       */
/* ========================================================================== */

const fileOf = (sq) => sq & 7;
const rankOf = (sq) => sq >> 3;
const makeSquare = (file, rank) => rank * 8 + file;

const inBoard = (file, rank) => file >= 0 && file < 8 && rank >= 0 && rank < 8;

/** Knight offsets as [dFile, dRank]. */
const KNIGHT_DELTAS = [
  [1, 2], [2, 1], [2, -1], [1, -2],
  [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];
const KING_DELTAS = [
  [1, 0], [1, 1], [0, 1], [-1, 1],
  [-1, 0], [-1, -1], [0, -1], [1, -1],
];

/** Sliding directions as [dFile, dRank]. */
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
const ROOK_DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const QUEEN_DIRS = [...BISHOP_DIRS, ...ROOK_DIRS];

/** KNIGHT_ATTACKS[sq] -> array of attacked squares. */
export const KNIGHT_ATTACKS = (() => {
  const table = new Array(64);
  for (let sq = 0; sq < 64; sq++) {
    const list = [];
    const f = fileOf(sq);
    const r = rankOf(sq);
    for (const [df, dr] of KNIGHT_DELTAS) {
      if (inBoard(f + df, r + dr)) list.push(makeSquare(f + df, r + dr));
    }
    table[sq] = list;
  }
  return table;
})();

export const KING_ATTACKS = (() => {
  const table = new Array(64);
  for (let sq = 0; sq < 64; sq++) {
    const list = [];
    const f = fileOf(sq);
    const r = rankOf(sq);
    for (const [df, dr] of KING_DELTAS) {
      if (inBoard(f + df, r + dr)) list.push(makeSquare(f + df, r + dr));
    }
    table[sq] = list;
  }
  return table;
})();

/** PAWN_ATTACKS[color][sq] -> squares attacked by a pawn of `color` on `sq`. */
export const PAWN_ATTACKS = (() => {
  const table = { [WHITE]: new Array(64), [BLACK]: new Array(64) };
  for (let sq = 0; sq < 64; sq++) {
    const f = fileOf(sq);
    const r = rankOf(sq);
    for (const color of [WHITE, BLACK]) {
      const dir = color === WHITE ? 1 : -1;
      const list = [];
      if (inBoard(f - 1, r + dir)) list.push(makeSquare(f - 1, r + dir));
      if (inBoard(f + 1, r + dir)) list.push(makeSquare(f + 1, r + dir));
      table[color][sq] = list;
    }
  }
  return table;
})();

/**
 * RAYS[dirIndex][sq] -> ordered list of squares along that ray, excluding sq.
 * Direction indices 0-3 are the diagonals, 4-7 the orthogonals, matching
 * BISHOP_DIR_BASE / ROOK_DIR_BASE.
 */
export const RAYS = (() => {
  const dirs = QUEEN_DIRS;
  const table = dirs.map(() => new Array(64));
  for (let d = 0; d < dirs.length; d++) {
    const [df, dr] = dirs[d];
    for (let sq = 0; sq < 64; sq++) {
      const list = [];
      let f = fileOf(sq) + df;
      let r = rankOf(sq) + dr;
      while (inBoard(f, r)) {
        list.push(makeSquare(f, r));
        f += df;
        r += dr;
      }
      table[d][sq] = list;
    }
  }
  return table;
})();

export const BISHOP_DIR_BASE = 0;
export const ROOK_DIR_BASE = 4;

/* ========================================================================== */
/* Square helpers                                                              */
/* ========================================================================== */

const FILES = 'abcdefgh';

export function squareName(sq) {
  return FILES[fileOf(sq)] + String(rankOf(sq) + 1);
}

export function squareIndex(name) {
  if (typeof name !== 'string' || name.length !== 2) return -1;
  const file = FILES.indexOf(name[0].toLowerCase());
  const rank = parseInt(name[1], 10) - 1;
  if (file < 0 || !(rank >= 0 && rank < 8)) return -1;
  return makeSquare(file, rank);
}

export function isLightSquare(sq) {
  return (fileOf(sq) + rankOf(sq)) % 2 === 1;
}

/** Is `piece` owned by `color`? */
export function colorOf(piece) {
  if (piece === EMPTY) return null;
  return piece > 0 ? WHITE : BLACK;
}

export function opponent(color) {
  return color === WHITE ? BLACK : WHITE;
}

export const absPiece = (piece) => (piece < 0 ? -piece : piece);

/* ========================================================================== */
/* Position / Game state                                                       */
/* ========================================================================== */

/**
 * A Position is the immutable-ish snapshot of the board.
 * A Game wraps a Position plus the move history required for undo, repetition
 * detection, clocks, and PGN export.
 *
 * @typedef {Object} Position
 * @property {Int8Array} board
 * @property {'w'|'b'} turn
 * @property {{K:boolean,Q:boolean,k:boolean,q:boolean}} castling
 * @property {number} ep  en-passant target square, or -1
 * @property {number} halfmove  plies since last capture/pawn move
 * @property {number} fullmove
 */

export function createPosition(fen = START_FEN) {
  const pos = {
    board: new Int8Array(64),
    turn: WHITE,
    castling: { K: false, Q: false, k: false, q: false },
    ep: -1,
    halfmove: 0,
    fullmove: 1,
  };
  if (fen) loadFen(pos, fen);
  return pos;
}

/**
 * Create a Game (position + history).
 * @param {string} [fen]
 */
export function createGame(fen = START_FEN) {
  const game = {
    position: createPosition(fen),
    /** @type {Array<{move:object, undo:object, san:string, key:string, capturedPiece:number}>} */
    history: [],
    /** Position keys used for repetition detection (includes start position). */
    keys: [],
    headers: {},
    result: '*',
  };
  game.keys.push(positionKey(game.position));
  return game;
}

export function clonePosition(pos) {
  return {
    board: Int8Array.from(pos.board),
    turn: pos.turn,
    castling: { ...pos.castling },
    ep: pos.ep,
    halfmove: pos.halfmove,
    fullmove: pos.fullmove,
  };
}

export function cloneGame(game) {
  return {
    position: clonePosition(game.position),
    history: game.history.map((h) => ({ ...h })),
    keys: [...game.keys],
    headers: { ...game.headers },
    result: game.result,
  };
}

/* ========================================================================== */
/* FEN                                                                         */
/* ========================================================================== */

export function positionToFen(pos) {
  let fen = '';
  for (let rank = 7; rank >= 0; rank--) {
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const piece = pos.board[makeSquare(file, rank)];
      if (piece === EMPTY) {
        empty++;
        continue;
      }
      if (empty) {
        fen += String(empty);
        empty = 0;
      }
      const letter = PIECE_LETTERS[absPiece(piece)];
      fen += piece > 0 ? letter.toUpperCase() : letter;
    }
    if (empty) fen += String(empty);
    if (rank > 0) fen += '/';
  }

  let castling = '';
  if (pos.castling.K) castling += 'K';
  if (pos.castling.Q) castling += 'Q';
  if (pos.castling.k) castling += 'k';
  if (pos.castling.q) castling += 'q';
  if (!castling) castling = '-';

  const ep = pos.ep >= 0 ? squareName(pos.ep) : '-';
  return `${fen} ${pos.turn} ${castling} ${ep} ${pos.halfmove} ${pos.fullmove}`;
}

/** Validate a FEN string and return {ok, error}. */
export function validateFen(fen) {
  if (typeof fen !== 'string') return { ok: false, error: 'FEN must be a string.' };
  const trimmed = fen.trim();
  if (!trimmed) return { ok: false, error: 'FEN is empty.' };

  const parts = trimmed.split(/\s+/);
  if (parts.length < 4) {
    return {
      ok: false,
      error: `A FEN needs at least 4 fields (placement, turn, castling, en passant); got ${parts.length}.`,
    };
  }
  const [placement, turn, castling, ep] = parts;

  const rows = placement.split('/');
  if (rows.length !== 8) {
    return { ok: false, error: 'Board placement must contain exactly 8 ranks separated by "/".' };
  }
  for (let i = 0; i < 8; i++) {
    let count = 0;
    for (const ch of rows[i]) {
      if (ch >= '1' && ch <= '8') count += Number(ch);
      else if ('pnbrqkPNBRQK'.includes(ch)) count += 1;
      else return { ok: false, error: `Invalid character "${ch}" in rank ${8 - i} of the FEN.` };
    }
    if (count !== 8) {
      return { ok: false, error: `Rank ${8 - i} of the FEN covers ${count} squares; it must cover 8.` };
    }
  }

  if (turn !== 'w' && turn !== 'b') {
    return { ok: false, error: 'Turn field must be "w" or "b".' };
  }
  if (castling !== '-' && !/^[KQkq]{1,4}$/.test(castling)) {
    return { ok: false, error: 'Castling field must be "-" or a combination of K, Q, k, q.' };
  }
  if (ep !== '-' && squareIndex(ep) < 0) {
    return { ok: false, error: `En-passant field "${ep}" is not a valid square.` };
  }
  if (parts.length >= 5 && !/^\d+$/.test(parts[4])) {
    return { ok: false, error: 'Halfmove clock must be a non-negative integer.' };
  }
  if (parts.length >= 6 && !/^\d+$/.test(parts[5])) {
    return { ok: false, error: 'Fullmove number must be a non-negative integer.' };
  }

  // Piece sanity: exactly one king per side that is present.
  const counts = { wK: 0, bK: 0 };
  for (const ch of placement.replace(/\//g, '')) {
    if (ch === 'K') counts.wK++;
    if (ch === 'k') counts.bK++;
  }
  const hasWhite = /[PNBRQK]/.test(placement);
  const hasBlack = /[pnbrqk]/.test(placement);
  if (hasWhite && counts.wK !== 1) {
    return { ok: false, error: `White must have exactly one king (found ${counts.wK}).` };
  }
  if (hasBlack && counts.bK !== 1) {
    return { ok: false, error: `Black must have exactly one king (found ${counts.bK}).` };
  }
  // Pawns may never stand on the 1st or 8th rank.
  if (/[Pp]/.test(rows[0]) || /[Pp]/.test(rows[7])) {
    return { ok: false, error: 'Pawns cannot stand on the first or eighth rank.' };
  }

  return { ok: true };
}

/** Load a FEN into an existing position object. Throws on invalid input. */
export function loadFen(pos, fen) {
  const check = validateFen(fen);
  if (!check.ok) throw new Error(check.error);

  const parts = fen.trim().split(/\s+/);
  const [placement, turn, castling, ep, halfmove, fullmove] = parts;

  pos.board.fill(EMPTY);
  const rows = placement.split('/');
  for (let i = 0; i < 8; i++) {
    const rank = 7 - i;
    let file = 0;
    for (const ch of rows[i]) {
      if (ch >= '1' && ch <= '8') {
        file += Number(ch);
        continue;
      }
      const piece = LETTER_TO_PIECE[ch.toLowerCase()];
      pos.board[makeSquare(file, rank)] = ch === ch.toUpperCase() ? piece : -piece;
      file++;
    }
  }

  pos.turn = turn;
  pos.castling = {
    K: castling.includes('K'),
    Q: castling.includes('Q'),
    k: castling.includes('k'),
    q: castling.includes('q'),
  };
  pos.ep = ep === '-' ? -1 : squareIndex(ep);
  pos.halfmove = halfmove !== undefined ? Number(halfmove) : 0;
  pos.fullmove = fullmove !== undefined ? Number(fullmove) : 1;

  // A FEN may declare castling rights whose rook/king is not in place.
  if (!findKing(pos, WHITE)) {
    pos.castling.K = false;
    pos.castling.Q = false;
  } else {
    const kSq = findKing(pos, WHITE);
    if (kSq !== squareIndex('e1')) {
      pos.castling.K = false;
      pos.castling.Q = false;
    } else {
      if (absPiece(pos.board[squareIndex('h1')]) !== ROOK || pos.board[squareIndex('h1')] < 0) {
        pos.castling.K = false;
      }
      if (absPiece(pos.board[squareIndex('a1')]) !== ROOK || pos.board[squareIndex('a1')] < 0) {
        pos.castling.Q = false;
      }
    }
  }
  if (!findKing(pos, BLACK)) {
    pos.castling.k = false;
    pos.castling.q = false;
  } else {
    const kSq = findKing(pos, BLACK);
    if (kSq !== squareIndex('e8')) {
      pos.castling.k = false;
      pos.castling.q = false;
    } else {
      if (absPiece(pos.board[squareIndex('h8')]) !== ROOK || pos.board[squareIndex('h8')] > 0) {
        pos.castling.k = false;
      }
      if (absPiece(pos.board[squareIndex('a8')]) !== ROOK || pos.board[squareIndex('a8')] > 0) {
        pos.castling.q = false;
      }
    }
  }

  // An en-passant square is only meaningful when a pawn can actually capture.
  if (pos.ep >= 0) {
    const epFile = fileOf(pos.ep);
    const epRank = rankOf(pos.ep);
    const pawnRank = pos.turn === WHITE ? epRank - 1 : epRank + 1;
    let legalEp = false;
    for (const df of [-1, 1]) {
      const f = epFile + df;
      if (!inBoard(f, pawnRank)) continue;
      const p = pos.board[makeSquare(f, pawnRank)];
      if (p !== EMPTY && colorOf(p) === pos.turn && absPiece(p) === PAWN) legalEp = true;
    }
    if (!legalEp) pos.ep = -1;
  }
}

/** Convenience: build a fresh game from a FEN string. */
export function gameFromFen(fen) {
  return createGame(fen);
}

/* ========================================================================== */
/* Attack detection                                                            */
/* ========================================================================== */

export function findKing(pos, color) {
  const target = color === WHITE ? KING : -KING;
  for (let sq = 0; sq < 64; sq++) if (pos.board[sq] === target) return sq;
  return -1;
}

/**
 * Is `sq` attacked by any piece of `byColor`?
 * Uses cheap short-range checks first for speed.
 */
export function isSquareAttacked(board, sq, byColor) {
  const sign = byColor === WHITE ? 1 : -1;

  // Pawns
  const pawnDir = byColor === WHITE ? -1 : 1;
  const f = fileOf(sq);
  const r = rankOf(sq);
  for (const df of [-1, 1]) {
    const nf = f + df;
    const nr = r + pawnDir;
    if (inBoard(nf, nr) && board[makeSquare(nf, nr)] === sign * PAWN) return true;
  }

  // Knights
  for (const target of KNIGHT_ATTACKS[sq]) {
    if (board[target] === sign * KNIGHT) return true;
  }

  // King
  for (const target of KING_ATTACKS[sq]) {
    if (board[target] === sign * KING) return true;
  }

  // Sliding: bishops/queens
  for (let d = 0; d < 4; d++) {
    const ray = RAYS[BISHOP_DIR_BASE + d][sq];
    for (let i = 0; i < ray.length; i++) {
      const piece = board[ray[i]];
      if (piece === EMPTY) continue;
      if (piece === sign * BISHOP || piece === sign * QUEEN) return true;
      break;
    }
  }

  // Sliding: rooks/queens
  for (let d = 0; d < 4; d++) {
    const ray = RAYS[ROOK_DIR_BASE + d][sq];
    for (let i = 0; i < ray.length; i++) {
      const piece = board[ray[i]];
      if (piece === EMPTY) continue;
      if (piece === sign * ROOK || piece === sign * QUEEN) return true;
      break;
    }
  }

  return false;
}

/** Is the side to move in check? */
export function inCheck(pos, color = pos.turn) {
  const kSq = findKing(pos, color);
  if (kSq < 0) return false;
  return isSquareAttacked(pos.board, kSq, opponent(color));
}

/* ========================================================================== */
/* Move generation                                                             */
/* ========================================================================== */

function makeMoveObject(from, to, piece, captured, flags, promotion = 0) {
  return { from, to, piece, captured, flags, promotion };
}

/**
 * Generate all pseudo-legal moves for the side to move.
 * Castling rights and paths are respected; legality w.r.t. the own king is
 * verified separately by generateLegalMoves().
 */
export function generatePseudoLegalMoves(pos, onlyCaptures = false) {
  const board = pos.board;
  const us = pos.turn;
  const them = opponent(us);
  const sign = us === WHITE ? 1 : -1;
  const moves = [];

  for (let from = 0; from < 64; from++) {
    const piece = board[from];
    if (piece === EMPTY || colorOf(piece) !== us) continue;
    const type = absPiece(piece);

    switch (type) {
      case PAWN: {
        const dir = us === WHITE ? 8 : -8;
        const startRank = us === WHITE ? 1 : 6;
        const promoRank = us === WHITE ? 7 : 0;
        const one = from + dir;
        if (!onlyCaptures && one >= 0 && one < 64 && board[one] === EMPTY) {
          if (rankOf(one) === promoRank) {
            for (const promo of [QUEEN, ROOK, BISHOP, KNIGHT]) {
              moves.push(makeMoveObject(from, one, piece, EMPTY, FLAG.PROMOTION, promo));
            }
          } else {
            moves.push(makeMoveObject(from, one, piece, EMPTY, FLAG.NORMAL));
            if (rankOf(from) === startRank) {
              const two = from + 2 * dir;
              if (board[two] === EMPTY) {
                moves.push(makeMoveObject(from, two, piece, EMPTY, FLAG.DOUBLE_PAWN));
              }
            }
          }
        }
        for (const to of PAWN_ATTACKS[us][from]) {
          const target = board[to];
          if (target !== EMPTY && colorOf(target) === them) {
            if (rankOf(to) === promoRank) {
              for (const promo of [QUEEN, ROOK, BISHOP, KNIGHT]) {
                moves.push(makeMoveObject(from, to, piece, target, FLAG.CAPTURE | FLAG.PROMOTION, promo));
              }
            } else {
              moves.push(makeMoveObject(from, to, piece, target, FLAG.CAPTURE));
            }
          } else if (to === pos.ep && target === EMPTY) {
            moves.push(makeMoveObject(from, to, piece, sign * -PAWN, FLAG.EP_CAPTURE));
          }
        }
        break;
      }
      case KNIGHT: {
        for (const to of KNIGHT_ATTACKS[from]) {
          const target = board[to];
          if (target === EMPTY) {
            if (!onlyCaptures) moves.push(makeMoveObject(from, to, piece, EMPTY, FLAG.NORMAL));
          } else if (colorOf(target) === them) {
            moves.push(makeMoveObject(from, to, piece, target, FLAG.CAPTURE));
          }
        }
        break;
      }
      case KING: {
        for (const to of KING_ATTACKS[from]) {
          const target = board[to];
          if (target === EMPTY) {
            if (!onlyCaptures) moves.push(makeMoveObject(from, to, piece, EMPTY, FLAG.NORMAL));
          } else if (colorOf(target) === them) {
            moves.push(makeMoveObject(from, to, piece, target, FLAG.CAPTURE));
          }
        }
        if (!onlyCaptures) {
          if (us === WHITE && from === squareIndex('e1')) {
            if (pos.castling.K && board[squareIndex('f1')] === EMPTY && board[squareIndex('g1')] === EMPTY) {
              moves.push(
                makeMoveObject(from, squareIndex('g1'), piece, EMPTY, FLAG.CASTLE_KS),
              );
            }
            if (
              pos.castling.Q &&
              board[squareIndex('d1')] === EMPTY &&
              board[squareIndex('c1')] === EMPTY &&
              board[squareIndex('b1')] === EMPTY
            ) {
              moves.push(
                makeMoveObject(from, squareIndex('c1'), piece, EMPTY, FLAG.CASTLE_QS),
              );
            }
          } else if (us === BLACK && from === squareIndex('e8')) {
            if (pos.castling.k && board[squareIndex('f8')] === EMPTY && board[squareIndex('g8')] === EMPTY) {
              moves.push(
                makeMoveObject(from, squareIndex('g8'), piece, EMPTY, FLAG.CASTLE_KS),
              );
            }
            if (
              pos.castling.q &&
              board[squareIndex('d8')] === EMPTY &&
              board[squareIndex('c8')] === EMPTY &&
              board[squareIndex('b8')] === EMPTY
            ) {
              moves.push(
                makeMoveObject(from, squareIndex('c8'), piece, EMPTY, FLAG.CASTLE_QS),
              );
            }
          }
        }
        break;
      }
      default: {
        const base = type === BISHOP ? BISHOP_DIR_BASE : type === ROOK ? ROOK_DIR_BASE : 0;
        const dirCount = type === QUEEN ? 8 : 4;
        for (let d = 0; d < dirCount; d++) {
          const ray = RAYS[base + d][from];
          for (let i = 0; i < ray.length; i++) {
            const to = ray[i];
            const target = board[to];
            if (target === EMPTY) {
              if (!onlyCaptures) moves.push(makeMoveObject(from, to, piece, EMPTY, FLAG.NORMAL));
              continue;
            }
            if (colorOf(target) === them) {
              moves.push(makeMoveObject(from, to, piece, target, FLAG.CAPTURE));
            }
            break;
          }
        }
        break;
      }
    }
  }
  return moves;
}

/** Undo record used by unmakeMove. */
function makeUndo(pos, move, castlingSnapshot, epSnapshot, halfmoveSnapshot) {
  return {
    castling: castlingSnapshot,
    ep: epSnapshot,
    halfmove: halfmoveSnapshot,
    turn: pos.turn,
    fullmove: pos.fullmove,
    capturedSq: -1,
  };
}

/**
 * Apply `move` to `pos` (mutating). Returns an undo record.
 * The move MUST come from generatePseudoLegalMoves / generateLegalMoves.
 */
export function makeMove(pos, move) {
  const board = pos.board;
  const us = pos.turn;
  const castlingSnapshot = { ...pos.castling };
  const epSnapshot = pos.ep;
  const halfmoveSnapshot = pos.halfmove;
  const undo = makeUndo(pos, move, castlingSnapshot, epSnapshot, halfmoveSnapshot);

  const piece = move.piece || board[move.from];
  const type = absPiece(piece);

  board[move.from] = EMPTY;
  pos.ep = -1;
  pos.halfmove += 1;

  if (move.flags & FLAG.EP_CAPTURE) {
    const capturedSq = us === WHITE ? move.to - 8 : move.to + 8;
    undo.capturedSq = capturedSq;
    board[capturedSq] = EMPTY;
    pos.halfmove = 0;
  }

  if (move.flags & FLAG.PROMOTION) {
    board[move.to] = (us === WHITE ? 1 : -1) * move.promotion;
  } else {
    board[move.to] = piece;
  }

  if (type === PAWN) {
    pos.halfmove = 0;
    if (move.flags & FLAG.DOUBLE_PAWN) {
      pos.ep = (move.from + move.to) / 2;
    }
  }

  // Castling rook movement.
  if (move.flags & FLAG.CASTLE_KS) {
    if (us === WHITE) {
      board[squareIndex('f1')] = ROOK;
      board[squareIndex('h1')] = EMPTY;
    } else {
      board[squareIndex('f8')] = -ROOK;
      board[squareIndex('h8')] = EMPTY;
    }
  } else if (move.flags & FLAG.CASTLE_QS) {
    if (us === WHITE) {
      board[squareIndex('d1')] = ROOK;
      board[squareIndex('a1')] = EMPTY;
    } else {
      board[squareIndex('d8')] = -ROOK;
      board[squareIndex('a8')] = EMPTY;
    }
  }

  // Update castling rights.
  if (type === KING) {
    if (us === WHITE) {
      pos.castling.K = false;
      pos.castling.Q = false;
    } else {
      pos.castling.k = false;
      pos.castling.q = false;
    }
  }
  const touch = (sq) => {
    if (sq === squareIndex('a1')) pos.castling.Q = false;
    else if (sq === squareIndex('h1')) pos.castling.K = false;
    else if (sq === squareIndex('a8')) pos.castling.q = false;
    else if (sq === squareIndex('h8')) pos.castling.k = false;
  };
  touch(move.from);
  touch(move.to);

  if (us === BLACK) pos.fullmove += 1;
  pos.turn = opponent(us);
  return undo;
}

/** Revert a move applied with makeMove(). */
export function unmakeMove(pos, move, undo) {
  const board = pos.board;
  const us = undo.turn;

  pos.turn = us;
  pos.castling = undo.castling;
  pos.ep = undo.ep;
  pos.halfmove = undo.halfmove;
  pos.fullmove = undo.fullmove;

  const piece = move.flags & FLAG.PROMOTION
    ? (us === WHITE ? 1 : -1) * PAWN
    : move.piece || 0;

  board[move.from] = piece;
  board[move.to] = EMPTY;

  if (move.flags & FLAG.EP_CAPTURE) {
    const capturedSq = us === WHITE ? move.to - 8 : move.to + 8;
    board[capturedSq] = us === WHITE ? -PAWN : PAWN;
  } else if (move.flags & FLAG.CAPTURE) {
    board[move.to] = move.captured || 0;
  }

  if (move.flags & FLAG.CASTLE_KS) {
    if (us === WHITE) {
      board[squareIndex('h1')] = ROOK;
      board[squareIndex('f1')] = EMPTY;
    } else {
      board[squareIndex('h8')] = -ROOK;
      board[squareIndex('f8')] = EMPTY;
    }
  } else if (move.flags & FLAG.CASTLE_QS) {
    if (us === WHITE) {
      board[squareIndex('a1')] = ROOK;
      board[squareIndex('d1')] = EMPTY;
    } else {
      board[squareIndex('a8')] = -ROOK;
      board[squareIndex('d8')] = EMPTY;
    }
  }
}

/** Is the side that just moved leaving its own king attacked? */
export function leavesKingInCheck(pos, move) {
  const undo = makeMove(pos, move);
  // After the move it is the opponent's turn; check the side that moved.
  const kSq = findKing(pos, undo.turn);
  const bad = kSq >= 0 && isSquareAttacked(pos.board, kSq, opponent(undo.turn));
  unmakeMove(pos, move, undo);
  return bad;
}

/** All legal moves for the side to move. */
export function generateLegalMoves(pos, onlyCaptures = false) {
  const pseudo = generatePseudoLegalMoves(pos, onlyCaptures);
  const legal = [];
  for (const move of pseudo) {
    // Castling: the king may not be in check, nor pass through an attacked square.
    if (move.flags & (FLAG.CASTLE_KS | FLAG.CASTLE_QS)) {
      const them = opponent(pos.turn);
      const from = move.from;
      const step = move.flags & FLAG.CASTLE_KS ? 1 : -1;
      let illegal = isSquareAttacked(pos.board, from, them);
      if (!illegal) {
        let sq = from + step;
        const last = move.to;
        while (true) {
          if (isSquareAttacked(pos.board, sq, them)) {
            illegal = true;
            break;
          }
          if (sq === last) break;
          sq += step;
        }
      }
      if (illegal) continue;
    }
    if (!leavesKingInCheck(pos, move)) legal.push(move);
  }
  return legal;
}

/** Convenience for the Game wrapper. */
export function legalMoves(game) {
  return generateLegalMoves(game.position);
}

/** Captures and promotions only (quiescence search). */
export function legalCaptures(pos) {
  const pseudo = generatePseudoLegalMoves(pos, true);
  const legal = [];
  for (const move of pseudo) {
    if (!(move.flags & (FLAG.CAPTURE | FLAG.EP_CAPTURE | FLAG.PROMOTION))) continue;
    if (!leavesKingInCheck(pos, move)) legal.push(move);
  }
  return legal;
}

/* ========================================================================== */
/* Game-level move application (history, SAN, repetition)                      */
/* ========================================================================== */

/** Unique key for threefold repetition: placement + turn + castling + ep. */
export function positionKey(pos) {
  let s = '';
  for (let sq = 0; sq < 64; sq++) {
    const p = pos.board[sq];
    s += p === EMPTY ? '.' : p > 0 ? PIECE_LETTERS[p].toUpperCase() : PIECE_LETTERS[-p];
  }
  s += ' ' + pos.turn;
  s += ' ' + (pos.castling.K ? 'K' : '-') + (pos.castling.Q ? 'Q' : '-') +
       (pos.castling.k ? 'k' : '-') + (pos.castling.q ? 'q' : '-');
  s += ' ' + pos.ep;
  return s;
}

/**
 * Play `move` on the game, recording history + SAN.
 * Throws if the move is not legal in the current position.
 */
export function applyMove(game, move) {
  const pos = game.position;
  const legal = generateLegalMoves(pos);
  const found = legal.find(
    (m) =>
      m.from === move.from &&
      m.to === move.to &&
      (m.promotion || 0) === (move.promotion || 0),
  );
  if (!found) {
    throw new Error(
      `Illegal move: ${squareName(move.from)}${squareName(move.to)} is not legal in this position.`,
    );
  }
  const san = moveToSan(pos, found, legal);
  const capturedPiece = found.flags & FLAG.EP_CAPTURE
    ? (pos.turn === WHITE ? -PAWN : PAWN)
    : found.captured;

  const undo = makeMove(pos, found);
  const key = positionKey(pos);

  const entry = {
    move: found,
    undo,
    san,
    key,
    capturedPiece,
  };
  game.history.push(entry);
  game.keys.push(key);
  return entry;
}

/** Undo the last move. Returns the history entry, or null. */
export function undoMove(game) {
  const entry = game.history.pop();
  if (!entry) return null;
  unmakeMove(game.position, entry.move, entry.undo);
  game.keys.pop();
  return entry;
}

/**
 * Count how many times the current position (including itself) has occurred.
 */
export function repetitionCount(game) {
  const current = game.keys[game.keys.length - 1];
  let count = 0;
  for (const key of game.keys) if (key === current) count++;
  return count;
}

/* ========================================================================== */
/* SAN (Standard Algebraic Notation)                                           */
/* ========================================================================== */

const PROMOTION_LETTER = { [QUEEN]: 'Q', [ROOK]: 'R', [BISHOP]: 'B', [KNIGHT]: 'N' };

/**
 * Build SAN for a legal move. `legalList` (optional) is the pre-generated list
 * of legal moves used for disambiguation.
 */
export function moveToSan(pos, move, legalList = null) {
  const type = absPiece(move.piece || pos.board[move.from]);
  let san = '';

  if (move.flags & FLAG.CASTLE_KS) {
    san = 'O-O';
  } else if (move.flags & FLAG.CASTLE_QS) {
    san = 'O-O-O';
  } else if (type === PAWN) {
    if (move.flags & (FLAG.CAPTURE | FLAG.EP_CAPTURE)) {
      san = FILES[fileOf(move.from)] + 'x' + squareName(move.to);
    } else {
      san = squareName(move.to);
    }
    if (move.flags & FLAG.PROMOTION) san += '=' + PROMOTION_LETTER[move.promotion];
  } else {
    san = PIECE_LETTERS[type].toUpperCase();
    const list = legalList || generateLegalMoves(pos);
    const ambiguous = list.filter(
      (m) =>
        m !== move &&
        absPiece(m.piece || pos.board[m.from]) === type &&
        m.to === move.to &&
        m.from !== move.from,
    );
    if (ambiguous.length > 0) {
      const sameFile = ambiguous.some((m) => fileOf(m.from) === fileOf(move.from));
      const sameRank = ambiguous.some((m) => rankOf(m.from) === rankOf(move.from));
      if (!sameFile) san += FILES[fileOf(move.from)];
      else if (!sameRank) san += String(rankOf(move.from) + 1);
      else san += squareName(move.from);
    }
    if (move.flags & FLAG.CAPTURE) san += 'x';
    san += squareName(move.to);
  }

  // Check / checkmate suffix.
  const undo = makeMove(pos, move);
  if (inCheck(pos)) {
    const replies = generateLegalMoves(pos);
    san += replies.length === 0 ? '#' : '+';
  }
  unmakeMove(pos, move, undo);
  return san;
}

/* ========================================================================== */
/* UCI notation (engine interface)                                             */
/* ========================================================================== */

export function moveToUci(move) {
  let uci = squareName(move.from) + squareName(move.to);
  if (move.flags & FLAG.PROMOTION) uci += PROMOTION_LETTER[move.promotion].toLowerCase();
  return uci;
}

export function uciToMove(pos, uci) {
  if (typeof uci !== 'string') return null;
  const clean = uci.trim().toLowerCase().replace(/\s+/g, '');
  if (clean.length < 4 || clean.length > 5) return null;
  const from = squareIndex(clean.slice(0, 2));
  const to = squareIndex(clean.slice(2, 4));
  if (from < 0 || to < 0) return null;
  const promoChar = clean[4];
  const promo = promoChar ? { q: QUEEN, r: ROOK, b: BISHOP, n: KNIGHT }[promoChar] : 0;
  const list = generateLegalMoves(pos);
  return (
    list.find(
      (m) => m.from === from && m.to === to && ((m.flags & FLAG.PROMOTION ? m.promotion : 0) || 0) === (promo || 0),
    ) || null
  );
}

/* ========================================================================== */
/* SAN parsing (PGN import)                                                    */
/* ========================================================================== */

function normalizeSan(token) {
  return token
    .replace(/[!?+#\s]/g, '')
    .replace(/^0/, 'O')
    .replace(/0-0/g, 'O-O')
    .replace(/O-O-0/g, 'O-O-O')
    .trim();
}

/**
 * Resolve a SAN string to a legal move object, or null if it does not match.
 */
export function sanToMove(pos, san) {
  if (typeof san !== 'string') return null;
  const list = generateLegalMoves(pos);
  const cleaned = normalizeSan(san);
  if (!cleaned) return null;

  // Direct match against generated SAN.
  for (const move of list) {
    if (normalizeSan(moveToSan(pos, move, list)) === cleaned) return move;
  }
  // Tolerant fallback: strip the '=' from promotions ("e8Q" == "e8=Q").
  const alt = cleaned.replace('=', '');
  for (const move of list) {
    if (normalizeSan(moveToSan(pos, move, list)).replace('=', '') === alt) return move;
  }
  return null;
}

/* ========================================================================== */
/* Material / captured pieces                                                  */
/* ========================================================================== */

export const PIECE_VALUES = {
  [PAWN]: 1,
  [KNIGHT]: 3,
  [BISHOP]: 3,
  [ROOK]: 5,
  [QUEEN]: 9,
  [KING]: 0,
};

/**
 * Material balance from White's perspective, plus the lists of captured pieces
 * derived from the move history (so undo works correctly).
 */
export function materialInfo(game) {
  const capturedWhite = []; // White pieces that were captured
  const capturedBlack = []; // Black pieces that were captured
  for (const entry of game.history) {
    const piece = entry.capturedPiece;
    if (!piece) continue;
    if (piece > 0) capturedWhite.push(piece);
    else capturedBlack.push(-piece);
  }
  let balance = 0;
  for (const p of capturedBlack) balance += PIECE_VALUES[p];
  for (const p of capturedWhite) balance -= PIECE_VALUES[p];
  return { capturedWhite, capturedBlack, balance };
}

/** Point difference in favour of `color`, from the captured-piece lists. */
export function materialAdvantage(game, color) {
  const { balance } = materialInfo(game);
  return color === WHITE ? balance : -balance;
}

/** Insufficient material detection (FIDE Article 9.6 style common cases). */
export function hasInsufficientMaterial(pos) {
  const pieces = [];
  for (let sq = 0; sq < 64; sq++) {
    const p = pos.board[sq];
    if (p === EMPTY || absPiece(p) === KING) continue;
    pieces.push({ piece: p, sq });
  }
  if (pieces.length === 0) return true; // K vs K
  if (pieces.length === 1) {
    const t = absPiece(pieces[0].piece);
    return t === KNIGHT || t === BISHOP; // K+minor vs K
  }
  if (pieces.length === 2) {
    const a = pieces[0];
    const b = pieces[1];
    // K+B vs K+B with bishops on the same colour complex.
    if (
      absPiece(a.piece) === BISHOP &&
      absPiece(b.piece) === BISHOP &&
      colorOf(a.piece) !== colorOf(b.piece) &&
      isLightSquare(a.sq) === isLightSquare(b.sq)
    ) {
      return true;
    }
    // K+N vs K+N (dead position, cannot be forced but commonly adjudicated draw)
    // is intentionally NOT included: mate is still legally possible.
  }
  // K+B+B vs K with both bishops on the same colour is not treated as draw.
  return false;
}

/* ========================================================================== */
/* Game status                                                                 */
/* ========================================================================== */

export const STATUS = {
  ONGOING: 'ongoing',
  CHECKMATE: 'checkmate',
  STALEMATE: 'stalemate',
  FIFTY_MOVE: 'fifty-move',
  SEVENTY_FIVE_MOVE: 'seventy-five-move',
  THREEFOLD: 'threefold',
  INSUFFICIENT_MATERIAL: 'insufficient-material',
  RESIGNATION: 'resignation',
  AGREED_DRAW: 'agreed-draw',
  TIMEOUT: 'timeout',
  ABANDONED: 'abandoned',
};

/**
 * Determine the status of the position at the current history point.
 * @param {object} game
 * @param {{autoFifty?: boolean}} [opts]
 */
export function gameStatus(game, opts = {}) {
  const pos = game.position;
  const moves = generateLegalMoves(pos);
  const check = inCheck(pos);

  if (moves.length === 0) {
    if (check) {
      return {
        over: true,
        status: STATUS.CHECKMATE,
        winner: opponent(pos.turn),
        description: `Checkmate — ${opponent(pos.turn) === WHITE ? 'White' : 'Black'} wins.`,
      };
    }
    return {
      over: true,
      status: STATUS.STALEMATE,
      winner: null,
      description: 'Stalemate — the game is a draw.',
    };
  }

  if (hasInsufficientMaterial(pos)) {
    return {
      over: true,
      status: STATUS.INSUFFICIENT_MATERIAL,
      winner: null,
      description: 'Draw — insufficient material to deliver checkmate.',
    };
  }

  if (pos.halfmove >= 150) {
    return {
      over: true,
      status: STATUS.SEVENTY_FIVE_MOVE,
      winner: null,
      description: 'Draw — 75 moves without a capture or pawn move.',
    };
  }

  if (repetitionCount(game) >= 3) {
    return {
      over: true,
      status: STATUS.THREEFOLD,
      winner: null,
      description: 'Draw — the same position occurred three times.',
    };
  }

  if (opts.autoFifty && pos.halfmove >= 100) {
    return {
      over: true,
      status: STATUS.FIFTY_MOVE,
      winner: null,
      description: 'Draw — 50 moves without a capture or pawn move.',
    };
  }

  return {
    over: false,
    status: STATUS.ONGOING,
    winner: null,
    check,
    description: `${pos.turn === WHITE ? 'White' : 'Black'} to move.`,
  };
}

/** True when the 50-move rule is claimable but not yet automatic. */
export function fiftyMoveClaimable(game) {
  return game.position.halfmove >= 100 && game.position.halfmove < 150;
}

/* ========================================================================== */
/* PGN                                                                         */
/* ========================================================================== */

const PGN_RESULT = {
  white: '1-0',
  black: '0-1',
  draw: '1/2-1/2',
  ongoing: '*',
};

/** Export the game as a PGN string. */
export function toPgn(game, options = {}) {
  const headers = {
    Event: game.headers.Event || 'MKJ Chess game',
    Site: game.headers.Site || 'MKJ Chess (offline)',
    Date: game.headers.Date || new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
    Round: game.headers.Round || '-',
    White: game.headers.White || 'White',
    Black: game.headers.Black || 'Black',
    ...(options.headers || {}),
  };

  const status = gameStatus(game);
  let result = PGN_RESULT.ongoing;
  if (status.status === STATUS.CHECKMATE) {
    result = status.winner === WHITE ? PGN_RESULT.white : PGN_RESULT.black;
  } else if (status.over) {
    result = PGN_RESULT.draw;
  } else if (game.result && game.result !== '*') {
    result = game.result;
  }
  if (options.result) result = options.result;
  headers.Result = result;

  let pgn = '';
  for (const [key, value] of Object.entries(headers)) {
    pgn += `[${key} "${String(value).replace(/"/g, '\\"')}"]\n`;
  }
  pgn += '\n';

  let line = '';
  const startTurn = game.startTurn || WHITE;
  let moveNumber = Math.max(1, game.startFullmove || 1);
  let expectBlack = startTurn === BLACK;

  for (let i = 0; i < game.history.length; i++) {
    const entry = game.history[i];
    let token;
    if (!expectBlack) {
      token = `${moveNumber}. ${entry.san}`;
    } else if (i === 0) {
      token = `${moveNumber}... ${entry.san}`;
    } else {
      token = entry.san;
    }

    if (line.length + token.length + 1 > 80) {
      pgn += line.trimEnd() + '\n';
      line = '';
    }
    line += token + ' ';

    if (expectBlack) moveNumber += 1;
    expectBlack = !expectBlack;
  }
  pgn += line.trimEnd();
  if (pgn.length && !pgn.endsWith('\n')) pgn += ' ';
  pgn += result + '\n';
  return pgn.replace(/\n\n+/g, '\n\n').trimEnd() + '\n';
}

/**
 * Parse a PGN string. Returns {ok, game, error}.
 * Header errors and illegal moves are reported with a move number when possible.
 */
export function parsePgn(pgn) {
  if (typeof pgn !== 'string' || !pgn.trim()) {
    return { ok: false, error: 'PGN text is empty.' };
  }

  const headers = {};
  const headerRe = /\[(\w+)\s+"([^"]*)"\]/g;
  let match;
  while ((match = headerRe.exec(pgn)) !== null) {
    headers[match[1]] = match[2];
  }

  let body = pgn.replace(headerRe, '');
  body = body.replace(/\{[^}]*\}/g, ' '); // {comments}
  body = body.replace(/;[^\n]*/g, ' '); // ; line comments
  body = body.replace(/\$\d+/g, ' '); // NAGs
  // Remove recursive variations (possibly nested).
  let guard = 0;
  while (body.includes('(') && guard++ < 50) {
    body = body.replace(/\((?:[^()]*|\([^()]*\))*\)/g, ' ');
  }

  const startFen = headers.FEN || headers.StartFEN || START_FEN;
  let game;
  try {
    game = createGame(startFen);
  } catch (err) {
    return { ok: false, error: `Invalid start position in PGN: ${err.message}` };
  }
  game.headers = headers;
  game.startFullmove = game.position.fullmove;
  game.startTurn = game.position.turn;

  // Extract the move tokens. Move numbers ("1.", "1...", "2") are stripped so
  // only SAN strings remain; the result and dashes are dropped too.
  const tokens = body
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t && !['1-0', '0-1', '1/2-1/2', '*', '-', '--'].includes(t))
    .map((t) => t.replace(/^\d+(\.{1,3})?/, '').trim())
    .filter(Boolean);

  let moveNumber = game.position.fullmove;
  let isBlackMove = game.position.turn === BLACK;
  let tokenIndex = 0;

  for (const token of tokens) {
    tokenIndex++;
    const label = `${moveNumber}${isBlackMove ? '...' : '.'}`;
    const resolved = sanToMove(game.position, token);
    if (!resolved) {
      return {
        ok: false,
        error: `Could not read move ${moveNumber} (${label.trim()}): "${token}" is not legal in the position reached so far.`,
        game,
        moveIndex: tokenIndex,
      };
    }
    applyMove(game, resolved);
    if (isBlackMove) moveNumber += 1;
    isBlackMove = !isBlackMove;
  }

  if (tokens.length === 0 && !headers.FEN) {
    return { ok: false, error: 'No moves found in the PGN text.' };
  }

  return { ok: true, game, headers };
}

/* ========================================================================== */
/* Utility for the UI: legal target squares from a square                      */
/* ========================================================================== */

/** Returns the legal moves that start on `from`. */
export function movesFrom(game, from) {
  return generateLegalMoves(game.position).filter((m) => m.from === from);
}

/** All squares that can be legally reached from `from`. */
export function targetsFrom(game, from) {
  return movesFrom(game, from).map((m) => m.to);
}

/** True when `piece` (on `sq`) is defended by any friendly piece. */
export function isDefended(pos, sq) {
  const piece = pos.board[sq];
  if (piece === EMPTY) return false;
  return isSquareAttacked(pos.board, sq, colorOf(piece));
}
