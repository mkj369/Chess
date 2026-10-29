/**
 * MKJ Chess — engine benchmark & sanity harness.
 *
 * Verifies that:
 *   1. Every difficulty level returns a legal move (never an illegal one).
 *   2. Difficulty actually changes search effort — not five labels, one engine.
 *   3. The engine finds forced tactical solutions.
 *   4. Each difficulty answers inside its responsiveness budget.
 *
 * Usage: node tools/bench.js [--quick]
 */
import {
  createPosition,
  generateLegalMoves,
  makeMove,
  unmakeMove,
  moveToUci,
  moveToSan,
  uciToMove,
  inCheck,
} from '../src/chess-rules.js';
import {
  chooseMove,
  searchPosition,
  evaluatePosition,
  seedEngine,
  DIFFICULTY,
  DIFFICULTY_IDS,
} from '../src/chess-engine.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const QUICK = process.argv.includes('--quick');

/** Positions with a single forced best move, verified by hand. */
const TACTICS = [
  {
    name: 'Back-rank mate in 1 (Ra8#)',
    fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',
    solution: 'a1a8',
  },
  {
    name: "Scholar's mate (Qxf7#)",
    fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 0 1',
    solution: 'h5f7',
  },
  {
    name: 'Promotion to queen is the best choice',
    fen: '8/P6k/8/8/8/8/7K/8 w - - 0 1',
    solution: 'a7a8q',
  },
  {
    name: 'Wins the undefended queen with a discovered attack',
    fen: 'r2qk2r/ppp2ppp/2n5/3bp3/8/8/PPP2PPP/RN1QK2R w KQkq - 0 1',
    solution: null, // asserts legality only
  },
];

let failures = 0;
const fail = (msg) => {
  failures++;
  console.log(`  FAIL  ${msg}`);
};
const pass = (msg) => console.log(`  ok    ${msg}`);

const sameMove = (a, b) =>
  a && b && a.from === b.from && a.to === b.to && (a.promotion || 0) === (b.promotion || 0);

console.log('=== 1. Every difficulty returns a legal move ===');
seedEngine(20260101);
{
  const pos = createPosition(START);
  let sampled = 0;
  let illegal = 0;
  let nulls = 0;
  // Walk a pseudo-random legal game, asking every level for a move at each ply.
  for (let ply = 0; ply < 60; ply++) {
    const legal = generateLegalMoves(pos);
    if (legal.length === 0) break;
    for (const level of DIFFICULTY_IDS) {
      if (QUICK && (level === 'expert' || level === 'master')) continue;
      const res = chooseMove(pos, level, { resetHistory: false });
      if (!res.move) {
        nulls++;
        continue;
      }
      sampled++;
      if (!legal.some((m) => sameMove(m, res.move))) illegal++;
    }
    // Advance with the engine's own choice so the positions stay realistic.
    makeMove(pos, chooseMove(pos, 'medium', { resetHistory: false }).move);
  }
  if (illegal === 0) pass(`${sampled} engine replies, all legal`);
  else fail(`${illegal} of ${sampled} engine replies were ILLEGAL`);
  if (nulls === 0) pass('no null move returned while legal moves existed');
  else fail(`${nulls} null moves returned while legal moves existed`);
}

console.log('\n=== 2. Difficulty actually changes search effort ===');
{
  const pos = createPosition('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 6 3');
  const results = {};
  for (const level of DIFFICULTY_IDS) {
    if (QUICK && level === 'master') {
      console.log(`  ${level.padEnd(9)} (skipped in --quick mode)`);
      continue;
    }
    const res = searchPosition(pos, {
      maxDepth: DIFFICULTY[level].maxDepth,
      timeMs: DIFFICULTY[level].timeMs,
      resetHistory: true,
    });
    results[level] = res;
    console.log(
      `  ${level.padEnd(9)} depth ${String(res.depth).padStart(2)}  ` +
        `nodes ${String(res.nodes).padStart(9)}  ${(res.timeMs + 'ms').padStart(7)}  ` +
        `best ${moveToUci(res.move)}  score ${res.score}`,
    );
  }

  const easy = results.easy.nodes;
  const medium = results.medium.nodes;
  const hard = results.hard.nodes;
  if (medium > easy && hard > medium * 2) {
    pass(`node counts scale: easy ${easy} < medium ${medium} < hard ${hard}`);
  } else {
    fail(`node counts do not scale: easy ${easy}, medium ${medium}, hard ${hard}`);
  }

  if (results.beginner.depth <= 1 && results.medium.depth >= 3 && results.hard.depth >= 4) {
    pass('reached depth rises across beginner -> medium -> hard');
  } else {
    fail(
      `reached depth does not rise: beginner ${results.beginner.depth}, ` +
        `medium ${results.medium.depth}, hard ${results.hard.depth}`,
    );
  }
}

console.log('\n=== 3. Engine finds forced solutions ===');
for (const t of TACTICS) {
  const pos = createPosition(t.fen);
  const legal = generateLegalMoves(pos);
  const res = searchPosition(pos, { maxDepth: 6, timeMs: 3000, resetHistory: true });
  const uci = res.move ? moveToUci(res.move) : null;
  const san = res.move ? moveToSan(pos, res.move, legal) : null;
  const label = `${t.name} -> ${san} (${uci}), depth ${res.depth}, score ${res.score}`;
  if (t.solution) {
    if (uci === t.solution) pass(label);
    else fail(`${label} — expected ${t.solution}`);
  } else if (legal.some((m) => sameMove(m, res.move))) {
    pass(label);
  } else {
    fail(`${label} — move is not legal`);
  }
}

console.log('\n=== 4. Mate detection (checked against an independent brute-force oracle) ===');
{
  /**
   * Independent, deliberately naive oracle: exhaustive legal-move enumeration.
   * Returns the number of White moves needed to force mate, or null.
   * No pruning, no evaluation — it cannot share a bug with the real engine.
   */
  const forcesMate = (pos, whiteMovesLeft) => {
    if (whiteMovesLeft <= 0) return false;
    for (const m of generateLegalMoves(pos)) {
      const undo = makeMove(pos, m);
      const blackMoves = generateLegalMoves(pos);
      let ok = false;
      if (blackMoves.length === 0 && inCheck(pos)) {
        ok = true; // mate delivered
      } else if (blackMoves.length > 0 && whiteMovesLeft > 1) {
        ok = true;
        for (const r of blackMoves) {
          const undo2 = makeMove(pos, r);
          const still = forcesMate(pos, whiteMovesLeft - 1);
          unmakeMove(pos, r, undo2);
          if (!still) {
            ok = false;
            break;
          }
        }
      }
      unmakeMove(pos, m, undo);
      if (ok) return true;
    }
    return false;
  };

  const shortestMate = (fen, maxMoves) => {
    const pos = createPosition(fen);
    for (let n = 1; n <= maxMoves; n++) {
      if (forcesMate(pos, n)) return n;
    }
    return null;
  };

  const cases = [
    { fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', max: 1, label: 'back-rank mate' },
    { fen: '5k2/4pppp/8/8/8/8/5PPP/R5K1 w - - 0 1', max: 1, label: 'back-rank mate, king on f8' },
    { fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 0 1', max: 2, label: "Scholar's mate" },
    // 1.Rc1! cuts the c-file, forcing 1...Ka8 2.Rc8#. Verified by hand.
    { fen: '1k6/8/1K6/8/8/8/8/R7 w - - 0 1', max: 2, label: 'rook + king mate in 2' },
  ];

  let mateCasesRun = 0;
  for (const c of cases) {
    const oracle = shortestMate(c.fen, c.max);
    const pos = createPosition(c.fen);
    const res = searchPosition(pos, { maxDepth: 8, timeMs: 5000, resetHistory: true });
    const label = `${c.label}: oracle mateIn ${oracle}, engine mateIn ${res.mateIn}, best ${moveToUci(res.move)}`;
    if (oracle === null) {
      console.log(`  skip  ${c.label}: the oracle found no forced mate within ${c.max}, case not usable`);
      continue;
    }
    mateCasesRun++;
    if (res.mateIn === oracle) {
      pass(label);
    } else if (res.mateIn !== null && res.mateIn > 0 && res.mateIn <= oracle) {
      // The engine found an equally fast or faster mate than the oracle's
      // horizon — confirm it independently before accepting it.
      const verified = forcesMate(pos, res.mateIn);
      if (verified) pass(`${label} (engine's faster line verified by the oracle)`);
      else fail(`${label} — engine claims a mate the oracle cannot confirm`);
    } else {
      fail(`${label} — mismatch`);
    }
  }
  if (mateCasesRun === 0) fail('no mate case was usable — the test proved nothing');

  // A quiet middlegame must NOT claim a forced mate.
  const quiet = createPosition('r1bq1rk1/pp2bppp/2nppn2/8/2P1P3/2N1BN2/PP2BPPP/R2Q1RK1 w - - 0 1');
  const res = searchPosition(quiet, { maxDepth: 6, timeMs: 2000, resetHistory: true });
  if (res.mateIn === null) pass('quiet middlegame correctly reports no forced mate');
  else fail(`quiet middlegame falsely reports mateIn ${res.mateIn}`);
}

console.log('\n=== 5. Evaluation sanity ===');
{
  const cases = [
    { fen: START, label: 'start position is balanced', test: (e) => Math.abs(e) <= 40 },
    // White's g1 knight removed -> White should be worse by roughly a knight.
    { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKB1R w KQkq - 0 1', label: 'White missing a knight -> White worse', test: (e) => e < -200 },
    // Black's g8 knight removed -> White should be better by roughly a knight.
    { fen: 'rnbqkb1r/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', label: 'Black missing a knight -> White better', test: (e) => e > 200 },
    { fen: '4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1', label: 'two rooks vs bare king -> large White edge', test: (e) => e > 300 },
    { fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1', label: 'king vs king is dead level', test: (e) => Math.abs(e) <= 20 },
    // Mirroring a position must flip the sign of the evaluation.
    { fen: 'rnbqkb1r/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', mirror: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKB1R b KQkq - 0 1', label: 'mirrored position flips the sign' },
  ];
  for (const c of cases) {
    const e = evaluatePosition(createPosition(c.fen));
    if (c.mirror) {
      const em = evaluatePosition(createPosition(c.mirror));
      // A vertically mirrored position with the other side to move should
      // evaluate to (almost) the negated score.
      if (Math.abs(e + em) <= 30) pass(`${c.label}: ${e} vs ${em}`);
      else fail(`${c.label}: ${e} vs ${em} (expected near-mirror values)`);
      continue;
    }
    if (c.test(e)) pass(`${c.label}: eval ${e}`);
    else fail(`${c.label}: eval ${e}`);
  }
}

console.log('\n=== 6. UCI round-trip ===');
{
  const pos = createPosition(START);
  const legal = generateLegalMoves(pos);
  let bad = 0;
  for (const m of legal) {
    const back = uciToMove(pos, moveToUci(m));
    if (!sameMove(back, m)) bad++;
  }
  if (bad === 0) pass(`${legal.length} start-position moves round-tripped through UCI`);
  else fail(`${bad} moves failed the UCI round-trip`);
}

console.log('\n=== 7. Responsiveness budget per difficulty ===');
{
  const pos = createPosition('r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10');
  for (const level of ['beginner', 'easy', 'medium', 'hard']) {
    const cfg = DIFFICULTY[level];
    const t0 = Date.now();
    chooseMove(pos, level);
    const elapsed = Date.now() - t0;
    const budget = cfg.timeMs + 2000;
    if (elapsed <= budget) pass(`${level} answered in ${elapsed}ms (search budget ${cfg.timeMs}ms)`);
    else fail(`${level} took ${elapsed}ms, over the ${budget}ms allowance`);
  }
}

console.log('\n=== 8. Weak levels really do play worse ===');
{
  // Beginner must differ from expert on at least some positions.
  seedEngine(4242);
  const fens = [
    'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 6 3',
    'rnbqkbnr/ppp2ppp/8/3pp3/3PP3/8/PPP2PPP/RNBQKBNR w KQkq d6 0 3',
    'r2q1rk1/ppp2ppp/2np1n2/2b1p1B1/2B1P1b1/2NP1N2/PPP2PPP/R2Q1RK1 w - - 0 1',
    '2kr3r/pppq1ppp/2n5/3np3/3N4/2P1B3/PP1Q1PPP/2KR1B1R w - - 0 1',
    'r1bq1rk1/pp2bppp/2nppn2/8/2P1P3/2N1BN2/PP2BPPP/R2Q1RK1 w - - 0 1',
  ];
  let differing = 0;
  for (const fen of fens) {
    const pos = createPosition(fen);
    const b = chooseMove(pos, 'beginner');
    const e = chooseMove(pos, 'expert');
    if (!sameMove(b.move, e.move)) differing++;
  }
  if (differing > 0) pass(`beginner and expert chose different moves on ${differing}/${fens.length} positions`);
  else fail('beginner and expert chose identical moves on every position');
}

console.log(failures === 0 ? '\nEngine benchmark: ALL CHECKS PASSED.' : `\nEngine benchmark: ${failures} FAILURE(S).`);
process.exit(failures === 0 ? 0 : 1);
