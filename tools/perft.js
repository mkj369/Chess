/**
 * MKJ Chess — perft (performance test) driver.
 *
 * perft counts the number of leaf nodes reachable at a given depth when every
 * legal move is played. Because the expected counts for standard test positions
 * are known exactly, a matching count proves the move generator handles pins,
 * checks, castling restrictions, en-passant expiry and promotion correctly.
 *
 * Usage: node tools/perft.js [depth] [--fast]
 */
import { createPosition, generateLegalMoves, makeMove, unmakeMove } from '../src/chess-rules.js';

export function perft(pos, depth) {
  if (depth === 0) return 1;
  const moves = generateLegalMoves(pos);
  if (depth === 1) return moves.length;
  let nodes = 0;
  for (const move of moves) {
    const undo = makeMove(pos, move);
    nodes += perft(pos, depth - 1);
    unmakeMove(pos, move, undo);
  }
  return nodes;
}

/** Standard perft test positions with their published node counts. */
export const PERFT_POSITIONS = [
  {
    name: 'Start position',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    counts: [1, 20, 400, 8902, 197281, 4865609, 119060324],
  },
  {
    name: 'Kiwipete',
    fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    counts: [1, 48, 2039, 97862, 4085603],
  },
  {
    name: 'Position 3 (pawn/pin endgame)',
    fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    counts: [1, 14, 191, 2812, 43238, 674624],
  },
  {
    name: 'Position 4 (promotions & pins)',
    fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    counts: [1, 6, 264, 9467, 422333],
  },
  {
    name: 'Position 4 mirrored',
    fen: 'r2q1rk1/pP1p2pp/Q4n2/bbp1p3/Np6/1B3NBn/pPPP1PPP/R3K2R b KQ - 0 1',
    counts: [1, 6, 264, 9467, 422333],
  },
  {
    name: 'Position 5',
    fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    counts: [1, 44, 1486, 62379, 2103487],
  },
  {
    name: 'Position 6',
    fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
    counts: [1, 46, 2079, 89890, 3894594],
  },
];

const runDepth = (name, fen, depth) => {
  const pos = createPosition(fen);
  const start = process.hrtime.bigint();
  const nodes = perft(pos, depth);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  return { name, depth, nodes, ms, nps: Math.round(nodes / (ms / 1000 || 1e-9)) };
};

if (process.argv[1] && process.argv[1].endsWith('perft.js')) {
  const args = process.argv.slice(2);
  const fast = args.includes('--fast');
  const depthArg = Number(args.find((a) => /^\d+$/.test(a)) || (fast ? 3 : 5));

  let failures = 0;
  for (const p of PERFT_POSITIONS) {
    const maxDepth = Math.min(depthArg, p.counts.length - 1);
    console.log(`\n=== ${p.name} ===\n${p.fen}`);
    for (let d = 1; d <= maxDepth; d++) {
      const r = runDepth(p.name, p.fen, d);
      const expected = p.counts[d];
      const ok = r.nodes === expected;
      if (!ok) failures++;
      console.log(
        `  depth ${d}: ${String(r.nodes).padStart(11)} ${ok ? 'OK' : `FAIL (expected ${expected})`}` +
          `   ${r.ms.toFixed(0)}ms  ${(r.nps / 1000).toFixed(0)}k nps`,
      );
    }
  }
  console.log(failures === 0 ? '\nAll perft positions passed.' : `\n${failures} perft check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}
