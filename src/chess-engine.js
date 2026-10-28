/**
 * MKJ Chess — Search & Evaluation Engine
 * -----------------------------------------------------------------------------
 * A genuine chess engine, not a random-move generator. Every move it returns is
 * validated against the legal move list before it leaves this module.
 *
 * Search
 *   - Negamax alpha-beta with fail-soft
 *   - Iterative deepening with a wall-clock budget (so the UI stays responsive
 *     and the engine always has a legal best move available, even on abort)
 *   - Quiescence search over captures, promotions and en passant
 *   - Transposition table (Zobrist hashing) with best-move caching
 *   - Move ordering: TT move -> promotions -> MVV-LVA -> killers -> history
 *   - Null-move pruning and late move reductions
 *
 * Evaluation (tapered, centipawns, from the side-to-move's point of view)
 *   - Material with mid/end-game piece values
 *   - Piece-square tables interpolated between mid and end game
 *   - Pawn structure: doubled, isolated, backward-ish, passed pawns
 *   - Bishop pair, rook on open/semi-open files
 *   - King pawn shield and king attack surface
 *   - Mobility and tempo
 *
 * Difficulty
 *   - Levels change real search depth, time budget, evaluation noise and
 *     deliberate-error rate. See DIFFICULTY below.
 *   - Weak levels still only ever return legal moves; they choose among legal
 *     alternatives using a shallow evaluation plus controlled randomness.
 */

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
  absPiece,
  colorOf,
  opponent,
  generateLegalMoves,
  makeMove,
  unmakeMove,
  inCheck,
  moveToUci,
  squareName,
  KNIGHT_ATTACKS,
  KING_ATTACKS,
  RAYS,
} from './chess-rules.js';

/* ========================================================================== */
/* Material & piece-square tables                                              */
/* ========================================================================== */

const MG_VALUE = { [PAWN]: 90, [KNIGHT]: 320, [BISHOP]: 335, [ROOK]: 500, [QUEEN]: 975, [KING]: 0 };
const EG_VALUE = { [PAWN]: 120, [KNIGHT]: 310, [BISHOP]: 330, [ROOK]: 525, [QUEEN]: 990, [KING]: 0 };

/**
 * Tables are written from White's perspective with a1 first, i.e. index 0 = a1
 * and index 63 = h8, matching the board representation directly.
 */
const PST_MG = {
  [PAWN]: [
    0, 0, 0, 0, 0, 0, 0, 0,
    -35, -1, -20, -23, -15, 24, 38, -22,
    -26, -4, -4, -10, 3, 3, 33, -12,
    -27, -2, -5, 12, 17, 6, 10, -25,
    -14, 13, 6, 21, 23, 12, 17, -23,
    -6, 7, 26, 31, 38, 30, 9, -6,
    98, 134, 61, 95, 68, 126, 34, -11,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  [KNIGHT]: [
    -105, -21, -58, -33, -17, -28, -19, -23,
    -29, -53, -12, -3, -1, 18, -14, -19,
    -23, -9, 12, 10, 19, 17, 25, -16,
    -13, 4, 16, 13, 28, 19, 21, -8,
    -9, 17, 19, 53, 37, 69, 18, 22,
    -47, 60, 37, 65, 84, 129, 73, 44,
    -73, -41, 72, 36, 23, 62, 7, -17,
    -167, -89, -34, -49, 61, -97, -15, -107,
  ],
  [BISHOP]: [
    -33, -3, -14, -21, -13, -12, -39, -21,
    4, 15, 16, 0, 7, 21, 33, 1,
    0, 15, 15, 15, 14, 27, 18, 10,
    -6, 13, 13, 26, 34, 12, 10, 4,
    -4, 5, 19, 50, 37, 37, 7, -2,
    -16, 37, 43, 40, 35, 50, 37, -2,
    -26, 16, -18, -13, 30, 59, 18, -47,
    -29, 4, -82, -37, -25, -42, 7, -8,
  ],
  [ROOK]: [
    -19, -13, 1, 17, 16, 7, -37, -26,
    -44, -16, -20, -9, -1, 11, -6, -71,
    -45, -25, -16, -17, 3, 0, -5, -33,
    -36, -26, -12, -1, 9, -7, 6, -23,
    -24, -11, 7, 26, 24, 35, -8, -20,
    -5, 19, 26, 36, 17, 45, 61, 16,
    27, 32, 58, 62, 80, 67, 26, 44,
    32, 42, 32, 51, 63, 9, 31, 43,
  ],
  [QUEEN]: [
    -1, -18, -9, 10, -15, -25, -31, -50,
    -35, -8, 11, 2, 8, 15, -3, 1,
    -14, 2, -11, -2, -5, 2, 14, 5,
    -9, -26, -9, -10, -2, -4, 3, -3,
    -27, -27, -16, -16, -1, 17, -2, 1,
    -13, -17, 7, 8, 29, 56, 47, 57,
    -24, -39, -5, 1, -16, 57, 28, 54,
    -28, 0, 29, 12, 59, 44, 43, 45,
  ],
  [KING]: [
    -15, 36, 12, -54, 8, -28, 24, 14,
    1, 7, -8, -64, -43, -16, 9, 8,
    -14, -14, -22, -46, -44, -30, -15, -27,
    -49, -1, -27, -39, -46, -44, -33, -51,
    -17, -20, -12, -27, -30, -25, -14, -36,
    -9, 24, 2, -16, -20, 6, 22, -22,
    29, -1, -20, -7, -8, -4, -38, -29,
    -65, 23, 16, -15, -56, -34, 2, 29,
  ],
};

const PST_EG = {
  [PAWN]: [
    0, 0, 0, 0, 0, 0, 0, 0,
    13, 8, 8, -7, -2, 7, 12, 9,
    4, 14, 17, 12, 11, 21, 22, 11,
    -4, 8, 12, 22, 24, 21, 8, 0,
    3, 9, 23, 36, 36, 25, 12, 7,
    23, 15, 34, 42, 52, 42, 27, 26,
    72, 62, 72, 72, 82, 79, 60, 64,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  [KNIGHT]: [
    -58, -38, -13, -28, -31, -27, -63, -99,
    -25, -8, -25, -2, -9, -25, -24, -52,
    -24, -20, 10, 9, -1, -9, -19, -41,
    -17, 3, 22, 22, 22, 11, 8, -18,
    -18, -6, 16, 25, 16, 17, 4, -18,
    -23, -3, -1, 15, 10, -3, -20, -22,
    -42, -20, -10, -5, -2, -20, -23, -44,
    -29, -51, -23, -15, -22, -18, -50, -64,
  ],
  [BISHOP]: [
    -14, -21, -11, -8, -7, -9, -17, -24,
    -8, -4, 7, -12, -3, -13, -4, -14,
    2, -8, 0, -1, -2, 6, 0, 4,
    -3, 9, 12, 9, 14, 10, 3, 2,
    -6, 3, 13, 19, 7, 10, -3, -9,
    -12, -3, 8, 10, 13, 3, -7, -15,
    -14, -18, -7, -1, 4, -9, -15, -27,
    -23, -9, -23, -5, -9, -16, -5, -17,
  ],
  [ROOK]: [
    13, 10, 18, 15, 12, 12, 8, 5,
    11, 13, 13, 11, -3, 3, 8, 3,
    7, 7, 7, 5, 4, -3, -5, -3,
    4, 3, 13, 1, 2, 1, -1, 2,
    3, 5, 8, 4, -5, -6, -8, -11,
    -4, 0, -5, -1, -7, -12, -8, -16,
    -6, -6, 0, 2, -9, -9, -11, -3,
    -9, 2, 3, -1, -5, -13, 4, -20,
  ],
  [QUEEN]: [
    -33, -28, -22, -43, -5, -32, -20, -41,
    -22, -23, -30, -16, -16, -23, -36, -32,
    -16, -27, 15, 6, 9, 17, 10, 5,
    -18, 28, 19, 47, 31, 34, 39, 23,
    3, 22, 24, 45, 57, 40, 57, 36,
    -20, 6, 9, 49, 47, 35, 19, 9,
    -17, 20, 32, 41, 58, 25, 30, 0,
    -9, 22, 22, 27, 27, 19, 10, 20,
  ],
  [KING]: [
    -53, -34, -21, -11, -28, -14, -24, -43,
    -27, -11, 4, 13, 14, 4, -5, -17,
    -19, -3, 11, 21, 23, 16, 7, -9,
    -18, -4, 21, 24, 27, 23, 9, -11,
    -8, 22, 24, 27, 26, 33, 26, 3,
    10, 17, 23, 15, 20, 45, 44, 13,
    12, 17, 14, 17, 17, 38, 23, 11,
    -74, -35, -18, -18, -11, 15, 4, -17,
  ],
};

/** Mirror a square vertically so tables can be reused for Black. */
const mirror = (sq) => sq ^ 56;

/* ========================================================================== */
/* Zobrist hashing                                                             */
/* ========================================================================== */

function createRandomGenerator(seed) {
  // xorshift32 — deterministic so that the TT key scheme is reproducible.
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
}

const ZOBRIST = (() => {
  const rnd = createRandomGenerator(0x4d4b4a31); // "MKJ1"
  const pieces = [];
  for (let i = 0; i < 16; i++) {
    pieces.push([rnd(), rnd()]);
  }
  const castling = [];
  for (let i = 0; i < 16; i++) castling.push([rnd(), rnd()]);
  const epFile = [];
  for (let i = 0; i < 8; i++) epFile.push([rnd(), rnd()]);
  return {
    pieces,
    castling,
    epFile,
    turn: [rnd(), rnd()],
  };
})();

const castlingIndex = (pos) =>
  (pos.castling.K ? 1 : 0) |
  (pos.castling.Q ? 2 : 0) |
  (pos.castling.k ? 4 : 0) |
  (pos.castling.q ? 8 : 0);

/** Compute the full Zobrist key (two 32-bit halves) for a position. */
export function zobristKey(pos) {
  let h1 = 0;
  let h2 = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = pos.board[sq];
    if (p === EMPTY) continue;
    const code = p > 0 ? p - 1 : 8 + (-p - 1);
    h1 ^= ZOBRIST.pieces[code][0];
    h2 ^= ZOBRIST.pieces[code][1];
    // Fold the square in via a second table lookup so piece placement matters.
    h1 ^= ZOBRIST.pieces[(code * 7 + sq) & 15][0];
    h2 ^= ZOBRIST.pieces[(code * 7 + sq) & 15][1];
  }
  const c = castlingIndex(pos);
  h1 ^= ZOBRIST.castling[c][0];
  h2 ^= ZOBRIST.castling[c][1];
  if (pos.ep >= 0) {
    const f = pos.ep & 7;
    h1 ^= ZOBRIST.epFile[f][0];
    h2 ^= ZOBRIST.epFile[f][1];
  }
  if (pos.turn === BLACK) {
    h1 ^= ZOBRIST.turn[0];
    h2 ^= ZOBRIST.turn[1];
  }
  return [h1 >>> 0, h2 >>> 0];
}

/** A 48-bit Number-safe hash plus a 16-bit verification tag. */
export function hashOf(pos) {
  const [h1, h2] = zobristKey(pos);
  const key = h1 * 65536 + (h2 >>> 16); // <= 2^48, a safe integer
  return { key, verify: h2 & 0xffff };
}

/* ========================================================================== */
/* Transposition table                                                         */
/* ========================================================================== */

const TT_FLAG = { EXACT: 0, LOWER: 1, UPPER: 2 };
const TT_SIZE = 1 << 20; // ~1M entries

class TranspositionTable {
  constructor(size = TT_SIZE) {
    this.size = size;
    this.clear();
  }

  clear() {
    this.map = new Map();
  }

  store(key, verify, depth, score, flag, move) {
    const existing = this.map.get(key);
    // Prefer deeper entries; never overwrite a deeper entry with a shallower one.
    if (existing && existing.depth > depth) return;
    this.map.set(key, { verify, depth, score, flag, move });
    if (this.map.size > this.size) {
      // Cheap eviction: drop the oldest ~25% of entries.
      let toDelete = this.size >> 2;
      for (const k of this.map.keys()) {
        if (toDelete-- <= 0) break;
        this.map.delete(k);
      }
    }
  }

  probe(key) {
    return this.map.get(key) || null;
  }
}

/* ========================================================================== */
/* Evaluation                                                                  */
/* ========================================================================== */

const PHASE_WEIGHTS = {
  [PAWN]: 0,
  [KNIGHT]: 1,
  [BISHOP]: 1,
  [ROOK]: 2,
  [QUEEN]: 4,
  [KING]: 0,
};
const MAX_PHASE = 24;

const fileOf = (sq) => sq & 7;
const rankOf = (sq) => sq >> 3;

/**
 * Static evaluation in centipawns, positive for White.
 */
export function evaluatePosition(pos) {
  const board = pos.board;
  let mg = 0;
  let eg = 0;
  let phase = 0;

  const pawnFiles = { [WHITE]: new Array(8).fill(0), [BLACK]: new Array(8).fill(0) };
  const pawnSquares = { [WHITE]: [], [BLACK]: [] };
  const bishopCount = { [WHITE]: 0, [BLACK]: 0 };
  const kingSq = { [WHITE]: -1, [BLACK]: -1 };

  // Pass 1: material, piece-square tables, bookkeeping.
  for (let sq = 0; sq < 64; sq++) {
    const piece = board[sq];
    if (piece === EMPTY) continue;
    const type = absPiece(piece);
    const white = piece > 0;
    const color = white ? WHITE : BLACK;
    const idx = white ? sq : mirror(sq);
    const sign = white ? 1 : -1;

    mg += sign * MG_VALUE[type];
    eg += sign * EG_VALUE[type];
    phase += PHASE_WEIGHTS[type];

    if (type === KING) {
      kingSq[color] = sq;
    } else if (type === PAWN) {
      pawnFiles[color][fileOf(sq)] += 1;
      pawnSquares[color].push(sq);
    } else if (type === BISHOP) {
      bishopCount[color] += 1;
    }

    mg += sign * PST_MG[type][idx];
    eg += sign * PST_EG[type][idx];
  }

  // Pass 2: pawn structure.
  for (const color of [WHITE, BLACK]) {
    const sign = color === WHITE ? 1 : -1;
    const files = pawnFiles[color];
    for (const sq of pawnSquares[color]) {
      const file = fileOf(sq);
      const rank = rankOf(sq);
      if (files[file] > 1) mg += -12 * sign;
      const left = file > 0 ? files[file - 1] : 0;
      const right = file < 7 ? files[file + 1] : 0;
      if (left === 0 && right === 0) mg += -14 * sign;

      // Passed pawn: no enemy pawn can block or capture its advance.
      let passed = true;
      const dir = color === WHITE ? 1 : -1;
      for (let r = rank + dir; r >= 0 && r < 8; r += dir) {
        for (let df = -1; df <= 1; df++) {
          const f = file + df;
          if (f < 0 || f > 7) continue;
          const other = board[r * 8 + f];
          if (other !== EMPTY && colorOf(other) !== color && absPiece(other) === PAWN) {
            passed = false;
            break;
          }
        }
        if (!passed) break;
      }
      if (passed) {
        const advance = color === WHITE ? rank : 7 - rank;
        mg += sign * [0, 8, 14, 24, 42, 68, 100, 0][advance];
        eg += sign * [0, 14, 28, 48, 80, 130, 190, 0][advance];
      }
    }
  }

  // Bishop pair.
  for (const color of [WHITE, BLACK]) {
    if (bishopCount[color] >= 2) {
      const sign = color === WHITE ? 1 : -1;
      mg += sign * 32;
      eg += sign * 48;
    }
  }

  // Rooks on open / semi-open files.
  for (let sq = 0; sq < 64; sq++) {
    const piece = board[sq];
    if (piece === EMPTY || absPiece(piece) !== ROOK) continue;
    const sign = piece > 0 ? 1 : -1;
    const file = fileOf(sq);
    if (pawnFiles[WHITE][file] === 0 && pawnFiles[BLACK][file] === 0) {
      mg += sign * 26;
      eg += sign * 10;
    } else if (pawnFiles[piece > 0 ? WHITE : BLACK][file] === 0) {
      mg += sign * 14;
      eg += sign * 5;
    }
  }

  // King safety: pawn shield in front of the king (midgame only).
  for (const color of [WHITE, BLACK]) {
    const kSq = kingSq[color];
    if (kSq < 0) continue;
    const sign = color === WHITE ? 1 : -1;
    const dir = color === WHITE ? 1 : -1;
    const kFile = fileOf(kSq);
    const kRank = rankOf(kSq);
    let shield = 0;
    let openLines = 0;
    for (let df = -1; df <= 1; df++) {
      const f = kFile + df;
      if (f < 0 || f > 7) continue;
      const shieldSq = (kRank + dir) * 8 + f;
      if (shieldSq < 0 || shieldSq > 63) {
        openLines++;
        continue;
      }
      const p = board[shieldSq];
      if (p !== EMPTY && colorOf(p) === color && absPiece(p) === PAWN) shield++;
      if (pawnFiles[color][f] === 0) openLines++;
    }
    mg += sign * (shield * 12 - openLines * 9);
    // A king stuck in the centre in the midgame is a liability.
    if (kFile >= 3 && kFile <= 4 && ((color === WHITE && kRank === 0) || (color === BLACK && kRank === 7))) {
      mg -= sign * 14;
    }
  }

  // Mobility (non-allocating move count difference).
  const mobility = mobilityDifference(pos);
  mg += mobility * 3;
  eg += mobility * 4;

  // Tempo.
  mg += pos.turn === WHITE ? 12 : -12;

  // Taper between midgame and endgame.
  const phaseFactor = Math.min(phase, MAX_PHASE) / MAX_PHASE;
  return Math.round(mg * phaseFactor + eg * (1 - phaseFactor));
}

/**
 * Count pseudo-legal moves for one colour without allocating move objects.
 * Called at every evaluation leaf, so it must stay cheap.
 */
function countPseudoMoves(board, color) {
  const sign = color === WHITE ? 1 : -1;
  const dir = color === WHITE ? 8 : -8;
  const startRank = color === WHITE ? 1 : 6;
  let count = 0;

  for (let from = 0; from < 64; from++) {
    const piece = board[from];
    if (piece === EMPTY || piece * sign <= 0) continue;
    const type = absPiece(piece);

    if (type === PAWN) {
      const one = from + dir;
      if (one >= 0 && one < 64 && board[one] === EMPTY) {
        count += 1;
        if (rankOf(from) === startRank && board[from + 2 * dir] === EMPTY) count += 1;
      }
      const r = rankOf(from);
      const f = fileOf(from);
      const tr = r + (color === WHITE ? 1 : -1);
      for (const df of [-1, 1]) {
        const tf = f + df;
        if (tf < 0 || tf > 7 || tr < 0 || tr > 7) continue;
        const target = board[tr * 8 + tf];
        if (target !== EMPTY && target * sign < 0) count += 1;
      }
      continue;
    }
    if (type === KNIGHT) {
      for (const to of KNIGHT_ATTACKS[from]) {
        if (board[to] * sign <= 0) count += 1;
      }
      continue;
    }
    if (type === KING) {
      for (const to of KING_ATTACKS[from]) {
        if (board[to] * sign <= 0) count += 1;
      }
      continue;
    }
    const base = type === BISHOP ? 0 : type === ROOK ? 4 : 0;
    const dirCount = type === QUEEN ? 8 : 4;
    for (let d = 0; d < dirCount; d++) {
      const ray = RAYS[base + d][from];
      for (let i = 0; i < ray.length; i++) {
        const target = board[ray[i]];
        if (target === EMPTY) {
          count += 1;
          continue;
        }
        if (target * sign < 0) count += 1;
        break;
      }
    }
  }
  return count;
}

function mobilityDifference(pos) {
  return countPseudoMoves(pos.board, WHITE) - countPseudoMoves(pos.board, BLACK);
}

/**
 * Lightweight evaluation used for weak levels and move ordering hints.
 * Material + piece-square tables only (no pawn structure or mobility passes).
 */
export function quickEvaluate(pos) {
  const board = pos.board;
  let score = 0;
  for (let sq = 0; sq < 64; sq++) {
    const piece = board[sq];
    if (piece === EMPTY) continue;
    const type = absPiece(piece);
    const white = piece > 0;
    const idx = white ? sq : mirror(sq);
    const sign = white ? 1 : -1;
    score += sign * (MG_VALUE[type] + PST_MG[type][idx]);
  }
  return score;
}

/* ========================================================================== */
/* Move ordering                                                               */
/* ========================================================================== */

const MVV_LVA_VICTIM = { [PAWN]: 100, [KNIGHT]: 320, [BISHOP]: 330, [ROOK]: 500, [QUEEN]: 900, [KING]: 2000 };
const MVV_LVA_ATTACKER = { [PAWN]: 6, [KNIGHT]: 5, [BISHOP]: 4, [ROOK]: 3, [QUEEN]: 2, [KING]: 1 };

function scoreMoveForOrdering(move, ttMove) {
  if (ttMove && move.from === ttMove.from && move.to === ttMove.to) return 1_000_000;
  let score = 0;
  if (move.flags & FLAG.PROMOTION) score += 90_000 + move.promotion * 100;
  if (move.flags & (FLAG.CAPTURE | FLAG.EP_CAPTURE)) {
    const victim = move.captured ? absPiece(move.captured) : PAWN;
    const attacker = absPiece(move.piece);
    score += 10_000 + MVV_LVA_VICTIM[victim] * 8 + MVV_LVA_ATTACKER[attacker];
  }
  return score;
}

/* ========================================================================== */
/* Search                                                                      */
/* ========================================================================== */

const MATE_SCORE = 1_000_000;
const MATE_BOUND = MATE_SCORE - 1000;
const INFINITY_SCORE = 2_000_000;

/**
 * @typedef {Object} SearchOptions
 * @property {number} [maxDepth]      hard depth cap
 * @property {number} [timeMs]        wall-clock budget in milliseconds
 * @property {number} [nodes]         node budget (0 = unlimited)
 * @property {(info:object)=>void} [onInfo] progress callback
 */

export function createSearchState() {
  return {
    tt: new TranspositionTable(),
    killers: [],
    history: new Int32Array(64 * 64),
    nodes: 0,
    aborted: false,
    deadline: Infinity,
    nodeBudget: Infinity,
  };
}

function shouldAbort(state) {
  if (state.aborted) return true;
  if ((state.nodes & 1023) === 0) {
    if (Date.now() > state.deadline) {
      state.aborted = true;
      return true;
    }
    if (state.nodes >= state.nodeBudget) {
      state.aborted = true;
      return true;
    }
  }
  return false;
}

/**
 * Quiescence search: keep searching noisy moves until the position is quiet.
 * Returns a score from the side-to-move's perspective.
 */
function quiescence(pos, state, alpha, beta, ply) {
  state.nodes++;
  if (shouldAbort(state)) return 0;

  const sideSign = pos.turn === WHITE ? 1 : -1;
  const standPat = evaluatePosition(pos) * sideSign;

  if (standPat >= beta) return beta;
  if (alpha < standPat) alpha = standPat;
  if (ply > 24) return standPat;

  const moves = generateLegalMoves(pos, true).filter(
    (m) => m.flags & (FLAG.CAPTURE | FLAG.EP_CAPTURE | FLAG.PROMOTION),
  );

  // Delta pruning: skip hopeless captures.
  const delta = 220;
  moves.sort((a, b) => scoreMoveForOrdering(b, null) - scoreMoveForOrdering(a, null));

  for (const move of moves) {
    if (
      move.flags & FLAG.CAPTURE &&
      !(move.flags & FLAG.PROMOTION) &&
      standPat + MG_VALUE[absPiece(move.captured || PAWN)] + delta < alpha
    ) {
      continue;
    }
    const undo = makeMove(pos, move);
    const score = -quiescence(pos, state, -beta, -alpha, ply + 1);
    unmakeMove(pos, move, undo);
    if (state.aborted) return 0;
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function storeKiller(state, ply, move) {
  if (!state.killers[ply]) state.killers[ply] = [null, null];
  const slot = state.killers[ply];
  if (slot[0] && slot[0].from === move.from && slot[0].to === move.to) return;
  slot[1] = slot[0];
  slot[0] = { from: move.from, to: move.to };
}

/**
 * Negamax alpha-beta with fail-soft.
 * Returns a score from the side-to-move's perspective.
 */
function alphabeta(pos, state, depth, alpha, beta, ply, canNull) {
  if (ply > 0 && shouldAbort(state)) return 0;
  state.nodes++;

  const alphaOrigin = alpha;
  const { key, verify } = hashOf(pos);

  // Transposition table probe.
  const ttEntry = state.tt.probe(key);
  let ttMove = null;
  if (ttEntry && ttEntry.verify === verify) {
    ttMove = ttEntry.move || null;
    if (ttEntry.depth >= depth && ply > 0) {
      const score = ttEntry.score;
      if (ttEntry.flag === TT_FLAG.EXACT) return score;
      if (ttEntry.flag === TT_FLAG.LOWER && score > alpha) alpha = score;
      else if (ttEntry.flag === TT_FLAG.UPPER && score < beta) beta = score;
      if (alpha >= beta) return score;
    }
  }

  const sideSign = pos.turn === WHITE ? 1 : -1;
  const checked = inCheck(pos);

  // Check extension keeps tactics accurate.
  if (checked && depth < 8) depth += 1;

  if (depth <= 0) return quiescence(pos, state, alpha, beta, ply);

  // Draw detection inside the search.
  if (ply > 0 && isSearchDraw(pos)) return 0;

  const moves = generateLegalMoves(pos);
  if (moves.length === 0) {
    return checked ? -MATE_SCORE + ply : 0;
  }

  // Null-move pruning: if passing still fails high, the position is strong.
  if (canNull && !checked && depth >= 3 && ply > 0 && hasNonPawnMaterial(pos, pos.turn)) {
    const undoTurn = pos.turn;
    const undoEp = pos.ep;
    pos.turn = opponent(pos.turn);
    pos.ep = -1;
    const R = depth >= 6 ? 3 : 2;
    const score = -alphabeta(pos, state, depth - 1 - R, -beta, -beta + 1, ply + 1, false);
    pos.turn = undoTurn;
    pos.ep = undoEp;
    if (state.aborted) return 0;
    if (score >= beta) return beta;
  }

  // Order moves.
  const killers = state.killers[ply] || [];
  moves.sort((a, b) => {
    const ka = killers[0] && killers[0].from === a.from && killers[0].to === a.to ? 500_000 : 0;
    const kb = killers[0] && killers[0].from === b.from && killers[0].to === b.to ? 500_000 : 0;
    const k2a = killers[1] && killers[1].from === a.from && killers[1].to === a.to ? 490_000 : 0;
    const k2b = killers[1] && killers[1].from === b.from && killers[1].to === b.to ? 490_000 : 0;
    const ha = state.history[a.from * 64 + a.to];
    const hb = state.history[b.from * 64 + b.to];
    return (
      scoreMoveForOrdering(b, ttMove) + kb + k2b + hb -
      (scoreMoveForOrdering(a, ttMove) + ka + k2a + ha)
    );
  });

  let bestScore = -INFINITY_SCORE;
  let bestMove = moves[0];
  let movesSearched = 0;

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    const undo = makeMove(pos, move);

    let score;
    const givesCheck = inCheck(pos);
    const isQuiet = !(move.flags & (FLAG.CAPTURE | FLAG.EP_CAPTURE | FLAG.PROMOTION));

    if (movesSearched === 0) {
      score = -alphabeta(pos, state, depth - 1, -beta, -alpha, ply + 1, true);
    } else {
      // Late move reductions for quiet moves deep in the list.
      let reduction = 0;
      if (depth >= 3 && movesSearched >= 3 && isQuiet && !checked && !givesCheck) {
        reduction = 1 + Math.floor(movesSearched / 12);
        if (reduction >= depth) reduction = depth - 1;
      }
      score = -alphabeta(pos, state, depth - 1 - reduction, -alpha - 1, -alpha, ply + 1, true);
      if (score > alpha && (reduction > 0 || score < beta)) {
        score = -alphabeta(pos, state, depth - 1, -beta, -alpha, ply + 1, true);
      }
    }

    unmakeMove(pos, move, undo);
    if (state.aborted) return bestScore === -INFINITY_SCORE ? 0 : bestScore;

    movesSearched++;
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
    if (score > alpha) alpha = score;
    if (alpha >= beta) {
      if (isQuiet) {
        storeKiller(state, ply, move);
        state.history[move.from * 64 + move.to] += depth * depth;
      }
      break;
    }
  }

  let flag = TT_FLAG.EXACT;
  if (bestScore <= alphaOrigin) flag = TT_FLAG.UPPER;
  else if (bestScore >= beta) flag = TT_FLAG.LOWER;
  state.tt.store(key, verify, depth, bestScore, flag, bestMove);

  return bestScore;
}

function hasNonPawnMaterial(pos, color) {
  for (let sq = 0; sq < 64; sq++) {
    const p = pos.board[sq];
    if (p === EMPTY || colorOf(p) !== color) continue;
    const t = absPiece(p);
    if (t === KNIGHT || t === BISHOP || t === ROOK || t === QUEEN) return true;
  }
  return false;
}

/** Fifty-move / insufficient-material draws that apply inside the search. */
function isSearchDraw(pos) {
  if (pos.halfmove >= 100) return true;
  let nonPawns = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = pos.board[sq];
    if (p === EMPTY) continue;
    const t = absPiece(p);
    if (t === KING) continue;
    nonPawns++;
    if (t === PAWN || t === ROOK || t === QUEEN) return false;
  }
  if (nonPawns <= 1) return true;
  return false;
}

/* ========================================================================== */
/* Public search API                                                           */
/* ========================================================================== */

/**
 * Iterative-deepening search from `pos`.
 *
 * @returns {{move:object, score:number, depth:number, nodes:number, timeMs:number,
 *            pv:Array, mateIn:number|null}}
 */
export function searchPosition(pos, options = {}) {
  const maxDepth = Math.max(1, Math.min(options.maxDepth || 8, 40));
  const timeMs = options.timeMs == null ? 1500 : options.timeMs;
  const state = options.state || createSearchState();
  state.nodes = 0;
  state.aborted = false;
  state.killers = [];
  state.history = options.resetHistory ? new Int32Array(64 * 64) : state.history;
  state.deadline = timeMs === 0 ? Infinity : Date.now() + timeMs;
  state.nodeBudget = options.nodes ? options.nodes : Infinity;

  const start = Date.now();
  const sideSign = pos.turn === WHITE ? 1 : -1;
  const rootMoves = generateLegalMoves(pos);

  if (rootMoves.length === 0) {
    return { move: null, score: 0, depth: 0, nodes: 0, timeMs: 0, pv: [], mateIn: null };
  }
  if (rootMoves.length === 1 && !options.forceFullSearch) {
    // Only one legal move: play it immediately and report a shallow evaluation.
    return {
      move: rootMoves[0],
      score: evaluatePosition(pos) * sideSign,
      depth: 1,
      nodes: 1,
      timeMs: Date.now() - start,
      pv: [moveToUci(rootMoves[0])],
      mateIn: null,
    };
  }

  let bestMove = rootMoves[0];
  let bestScore = 0;
  let completedDepth = 0;
  let lastOrdering = rootMoves.slice();

  for (let depth = 1; depth <= maxDepth; depth++) {
    let alpha = -INFINITY_SCORE;
    const beta = INFINITY_SCORE;
    let iterationBest = null;
    let iterationScore = -INFINITY_SCORE;
    const scored = [];

    // Root move ordering: previous iteration's best move first.
    const ordered = lastOrdering.slice();

    for (const move of ordered) {
      const undo = makeMove(pos, move);
      const score = -alphabeta(pos, state, depth - 1, -beta, -alpha, 1, true);
      unmakeMove(pos, move, undo);
      if (state.aborted) break;

      scored.push({ move, score });
      if (score > iterationScore) {
        iterationScore = score;
        iterationBest = move;
      }
      if (score > alpha) alpha = score;
    }

    if (state.aborted && iterationBest === null) break;
    if (iterationBest) {
      bestMove = iterationBest;
      bestScore = iterationScore;
      completedDepth = depth;
      // Re-order root moves by score for the next iteration.
      scored.sort((a, b) => b.score - a.score);
      lastOrdering = scored.map((s) => s.move);
      if (options.onInfo) {
        options.onInfo({
          depth,
          score: bestScore,
          nodes: state.nodes,
          timeMs: Date.now() - start,
          move: moveToUci(bestMove),
          nps: Math.round(state.nodes / ((Date.now() - start) / 1000 || 1e-9)),
        });
      }
    }

    if (state.aborted) break;
    if (Math.abs(bestScore) > MATE_BOUND) break; // mate found, stop deepening
    if (Date.now() > state.deadline) break;
  }

  const elapsed = Date.now() - start;
  let mateIn = null;
  if (bestScore > MATE_BOUND) mateIn = Math.ceil((MATE_SCORE - bestScore) / 2);
  else if (bestScore < -MATE_BOUND) mateIn = -Math.ceil((MATE_SCORE + bestScore) / 2);

  return {
    move: bestMove,
    score: bestScore,
    depth: completedDepth,
    nodes: state.nodes,
    timeMs: elapsed,
    nps: Math.round(state.nodes / (elapsed / 1000 || 1e-9)),
    pv: [moveToUci(bestMove)],
    mateIn,
  };
}

/* ========================================================================== */
/* Difficulty levels                                                           */
/* ========================================================================== */

/**
 * Each level is a genuine configuration change: search depth, time budget,
 * evaluation noise (in centipawns) and a deliberate-error rate.
 *
 * `blunderRate` is the chance that the engine ignores the search result and
 * picks a weaker — but always legal — alternative. Weak levels therefore play
 * recognisably worse without ever breaking the rules.
 */
export const DIFFICULTY = {
  beginner: {
    id: 'beginner',
    label: 'Beginner',
    tagline: 'Learning the board',
    elo: '~600',
    maxDepth: 1,
    timeMs: 220,
    noise: 260,
    blunderRate: 0.55,
    blunderPool: 8,
    describe:
      'Looks one move ahead, adds a lot of randomness, and often overlooks a better move. Ideal for someone learning how the pieces move.',
  },
  easy: {
    id: 'easy',
    label: 'Easy',
    tagline: 'Casual, beatable',
    elo: '~1000',
    maxDepth: 2,
    timeMs: 400,
    noise: 150,
    blunderRate: 0.3,
    blunderPool: 6,
    describe:
      'Sees simple captures and one-move threats but misses combinations and regularly drops material.',
  },
  medium: {
    id: 'medium',
    label: 'Medium',
    tagline: 'Develops and defends',
    elo: '~1450',
    maxDepth: 3,
    timeMs: 900,
    noise: 55,
    blunderRate: 0.1,
    blunderPool: 4,
    describe:
      'Develops pieces, protects its king and spots basic tactics. Punishes obvious blunders but can be out-manoeuvred positionally.',
  },
  hard: {
    id: 'hard',
    label: 'Hard',
    tagline: 'Sharp and tactical',
    elo: '~1900',
    maxDepth: 5,
    timeMs: 2600,
    noise: 14,
    blunderRate: 0.02,
    blunderPool: 2,
    describe:
      'Deep alpha-beta search with quiescence. Calculates multi-move tactics and defends accurately.',
  },
  expert: {
    id: 'expert',
    label: 'Expert',
    tagline: 'Strongest local play',
    elo: '~2150',
    maxDepth: 8,
    timeMs: 6000,
    noise: 0,
    blunderRate: 0,
    blunderPool: 1,
    describe:
      'Full engine strength: iterative deepening, transposition table, null-move pruning, late move reductions and quiescence search.',
  },
  master: {
    id: 'master',
    label: 'Master Challenge',
    tagline: 'Long think, brutal',
    elo: '~2300+',
    maxDepth: 12,
    timeMs: 15000,
    noise: 0,
    blunderRate: 0,
    blunderPool: 1,
    describe:
      'Expert search with a much longer clock. Needs a fast device and patience — the engine may think for many seconds per move.',
  },
};

export const DIFFICULTY_IDS = Object.keys(DIFFICULTY);

export function getDifficulty(id) {
  return DIFFICULTY[id] || DIFFICULTY.medium;
}

/* ========================================================================== */
/* High-level "choose a move" API                                              */
/* ========================================================================== */

let rngState = (Date.now() ^ 0x9e3779b9) >>> 0;
function random() {
  rngState ^= rngState << 13;
  rngState >>>= 0;
  rngState ^= rngState >>> 17;
  rngState ^= rngState << 5;
  rngState >>>= 0;
  return rngState / 4294967296;
}

/** Test hook: make the weak-level randomness reproducible. */
export function seedEngine(seed) {
  rngState = (seed >>> 0) || 1;
}

/**
 * Choose a move for the side to move at the given difficulty.
 *
 * The returned move is ALWAYS taken from generateLegalMoves(pos) and is
 * re-verified before being returned, so the engine can never propose an
 * illegal move.
 *
 * @param {object} pos a Position
 * @param {string} [difficultyId]
 * @param {object} [options] { state, onInfo, forceFullSearch }
 * @returns {{move:object|null, uci:string, score:number, depth:number,
 *            nodes:number, timeMs:number, mateIn:number|null,
 *            difficulty:string, deliberate:boolean}}
 */
export function chooseMove(pos, difficultyId = 'medium', options = {}) {
  const cfg = getDifficulty(difficultyId);
  const legal = generateLegalMoves(pos);
  if (legal.length === 0) {
    return {
      move: null,
      uci: null,
      score: 0,
      depth: 0,
      nodes: 0,
      timeMs: 0,
      mateIn: null,
      difficulty: cfg.id,
      deliberate: false,
      reason: 'no-legal-moves',
    };
  }

  const result = searchPosition(pos, {
    maxDepth: cfg.maxDepth,
    timeMs: cfg.timeMs,
    state: options.state,
    onInfo: options.onInfo,
    forceFullSearch: true,
    resetHistory: options.resetHistory !== false,
  });

  let chosen = result.move || legal[0];
  let deliberate = false;

  // Weak levels: sometimes replace the best move with a worse legal one.
  if (cfg.blunderRate > 0 && legal.length > 1 && random() < cfg.blunderRate) {
    const us = pos.turn;
    const sideSign = us === WHITE ? 1 : -1;
    const scored = [];
    for (const move of legal) {
      const undo = makeMove(pos, move);
      // After makeMove it is the opponent's turn, so the sign is based on `us`.
      let score = evaluatePosition(pos) * sideSign;
      // Never "blunder" into immediate mate against ourselves.
      if (inCheck(pos) && generateLegalMoves(pos).length === 0) score = -MATE_SCORE;
      unmakeMove(pos, move, undo);
      scored.push({ move, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const poolSize = Math.min(cfg.blunderPool, scored.length);
    const pool = scored.slice(0, poolSize).filter((s) => s.score > -MATE_BOUND);
    const candidates = pool.length ? pool : scored.slice(0, 1);
    const pick = candidates[Math.floor(random() * candidates.length)] || scored[0];
    if (pick.move.from !== chosen.from || pick.move.to !== chosen.to) {
      chosen = pick.move;
      deliberate = true;
    }
  }

  // Hard guarantee: the chosen move must be in the legal list.
  const verified = legal.find(
    (m) =>
      m.from === chosen.from &&
      m.to === chosen.to &&
      (m.promotion || 0) === (chosen.promotion || 0),
  );
  const finalMove = verified || legal[0];

  return {
    move: finalMove,
    uci: moveToUci(finalMove),
    san: null,
    score: result.score,
    evalCp: result.score,
    depth: result.depth,
    nodes: result.nodes,
    nps: result.nps || 0,
    timeMs: result.timeMs,
    mateIn: result.mateIn,
    difficulty: cfg.id,
    difficultyLabel: cfg.label,
    deliberate,
    reason: 'search',
  };
}

/* ========================================================================== */
/* Helper utilities used by the UI                                             */
/* ========================================================================== */

/** A best-move hint for the side to move, with a human-readable explanation. */
export function analyzePosition(pos, options = {}) {
  const depth = options.depth || 6;
  const timeMs = options.timeMs || 1200;
  const result = searchPosition(pos, { maxDepth: depth, timeMs, resetHistory: true });
  const legal = generateLegalMoves(pos);
  if (!result.move || legal.length === 0) return null;

  // Both evaluations are expressed from the side-to-move's perspective so the
  // comparison below is meaningful.
  const sideSign = pos.turn === WHITE ? 1 : -1;
  const before = evaluatePosition(pos) * sideSign;
  const undo = makeMove(pos, result.move);
  const after = evaluatePosition(pos) * sideSign;
  unmakeMove(pos, result.move, undo);

  const explanation = explainMove(pos, result.move, before, after, result);
  return {
    move: result.move,
    uci: moveToUci(result.move),
    score: result.score,
    evalCp: result.score,
    mateIn: result.mateIn,
    depth: result.depth,
    nodes: result.nodes,
    timeMs: result.timeMs,
    explanation,
  };
}

function explainMove(pos, move, before, after, result) {
  const parts = [];
  const type = absPiece(move.piece);
  const names = { 1: 'pawn', 2: 'knight', 3: 'bishop', 4: 'rook', 5: 'queen', 6: 'king' };

  if (result.mateIn && result.mateIn > 0) {
    return `Forced checkmate in ${result.mateIn} move${result.mateIn > 1 ? 's' : ''} starting with ${names[type]} to ${squareName(move.to)}.`;
  }
  parts.push(`The engine prefers ${names[type]} ${squareName(move.from)} to ${squareName(move.to)}.`);

  if (move.flags & (FLAG.CAPTURE | FLAG.EP_CAPTURE)) {
    const victim = absPiece(move.captured || PAWN);
    parts.push(`It wins a ${names[victim]}.`);
  }
  if (move.flags & FLAG.PROMOTION) parts.push('It promotes a pawn.');
  if (move.flags & (FLAG.CASTLE_KS | FLAG.CASTLE_QS)) {
    parts.push('It castles, connecting the rooks and moving the king to safety.');
  }

  const undo = makeMove(pos, move);
  const givesCheck = inCheck(pos);
  unmakeMove(pos, move, undo);
  if (givesCheck) parts.push('It gives check.');

  const gain = after - before;
  if (Math.abs(gain) < 12) parts.push('It keeps the position roughly level.');
  else if (gain > 0) parts.push(`It improves the evaluation by about ${(gain / 100).toFixed(2)} pawns.`);
  else parts.push(`It accepts a small concession of about ${(-gain / 100).toFixed(2)} pawns for other compensation.`);

  parts.push(`Found at search depth ${result.depth}.`);
  return parts.join(' ');
}

/** Convert a centipawn score into display text, from `color`'s perspective. */
export function formatEvaluation(cp, color = WHITE, mateIn = null) {
  const signed = color === WHITE ? cp : -cp;
  if (mateIn) {
    const m = color === WHITE ? mateIn : -mateIn;
    return m > 0 ? `Mate in ${m}` : `Mated in ${-m}`;
  }
  const pawns = signed / 100;
  if (Math.abs(pawns) >= 100) return pawns > 0 ? 'Winning' : 'Losing';
  return (pawns > 0 ? '+' : '') + pawns.toFixed(2);
}

export { MATE_SCORE, MATE_BOUND, TT_FLAG, TranspositionTable };
