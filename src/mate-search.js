/**
 * MKJ Chess — Forced-mate search (oracle)
 * -----------------------------------------------------------------------------
 * An exhaustive, unpruned search for a forced checkmate. It is used by:
 *   - the puzzle generator (tools/make-puzzles.js) to guarantee that every
 *     emitted puzzle really has a forced solution,
 *   - the in-game puzzle mode, to verify a player's attempt honestly,
 *   - the automated test-suite, to check the engine's mate scores.
 *
 * It shares no pruning, evaluation or move-ordering code with chess-engine.js,
 * so a bug in one cannot hide behind a bug in the other.
 */

import {
  generateLegalMoves,
  makeMove,
  unmakeMove,
  inCheck,
  moveToSan,
} from './chess-rules.js';

/**
 * Search for a forced mate in `whiteMoves` White moves from `pos`.
 *
 * @returns {{san:string, replies:Array, mate:boolean}|null}
 *   `replies` covers EVERY legal black reply — a forced mate must hold against
 *   all of them — and each reply carries its own subtree.
 */
export function findForcedMate(pos, whiteMoves) {
  if (whiteMoves <= 0) return null;

  for (const m of generateLegalMoves(pos)) {
    const san = moveToSan(pos, m);
    const undo = makeMove(pos, m);
    const blackMoves = generateLegalMoves(pos);

    let node = null;
    if (blackMoves.length === 0 && inCheck(pos)) {
      // moveToSan already appended the checkmate suffix.
      node = { san, replies: [], mate: true };
    } else if (blackMoves.length > 0 && whiteMoves > 1) {
      const replies = [];
      for (const r of blackMoves) {
        const rsan = moveToSan(pos, r);
        const undo2 = makeMove(pos, r);
        const sub = findForcedMate(pos, whiteMoves - 1);
        unmakeMove(pos, r, undo2);
        if (!sub) {
          replies.length = 0;
          break;
        }
        replies.push({ san: rsan, subtree: sub });
      }
      if (replies.length === blackMoves.length) node = { san, replies };
    }
    unmakeMove(pos, m, undo);
    if (node) return node;
  }
  return null;
}

/**
 * Find the shortest forced mate in `pos`, up to `maxMoves` White moves.
 *
 * @returns {{moves:number, tree:object, keyMoves:string[]}|null}
 *   `keyMoves` is White's moves along the principal line, for hints and display.
 */
export function shortestForcedMate(pos, maxMoves) {
  for (let n = 1; n <= maxMoves; n++) {
    const tree = findForcedMate(pos, n);
    if (tree) {
      const keyMoves = [];
      let node = tree;
      for (let i = 0; i < n; i++) {
        keyMoves.push(node.san);
        const first = node.replies[0];
        if (!first) break;
        node = first.subtree;
      }
      return { moves: n, tree, keyMoves };
    }
  }
  return null;
}

/**
 * Is `pos` currently a forced mate in at most `maxMoves` White moves?
 * Cheaper than shortestForcedMate when only a boolean is needed.
 */
export function hasForcedMate(pos, maxMoves) {
  return findForcedMate(pos, maxMoves) !== null;
}

/**
 * Count the total number of node positions in a mate tree. Useful for tests
 * that want to assert a puzzle is not trivially solvable.
 */
export function countMateNodes(tree) {
  if (!tree) return 0;
  let n = 1;
  for (const r of tree.replies) n += countMateNodes(r.subtree);
  return n;
}
