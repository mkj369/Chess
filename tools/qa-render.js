/**
 * MKJ Chess — artwork pixel QA (build-time only).
 *
 * Renders each of the 12 piece symbols standalone and verifies at the pixel
 * level (no vision required):
 *   - transparent background (alpha == 0 around the piece)
 *   - non-empty opaque content
 *   - visible MKJ engraving (dark pixels in the base band)
 *   - metallic gold accents present
 *   - consistent content bounding box across all 12 (same scale/centering)
 *
 * Usage: node tools/qa-render.js
 */
import { readFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const sprite = readFileSync(new URL('../assets/pieces-3d.svg', import.meta.url), 'utf8');
const TYPES = ['pawn', 'rook', 'knight', 'bishop', 'queen', 'king'];
const COLORS = ['w', 'b'];
const SIZE = 256;

function renderSymbol(id) {
  const block = sprite.match(new RegExp(`<symbol id="${id}"[\\s\\S]*?</symbol>`))[0];
  const inner = block.replace(/<symbol[^>]*>/, '').replace('</symbol>', '');
  // Include the top-level gradient defs so url(#...) resolves.
  const defs = sprite.match(/<defs>([\s\S]*?)<\/defs>/)[1];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${SIZE}" height="${SIZE}">${defs}${inner}</svg>`;
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: SIZE } });
  return resvg.render();
}

function analyze(pixels) {
  const W = SIZE;
  let transparent = 0;
  let opaque = 0;
  let minX = W, minY = W, maxX = 0, maxY = 0;
  let mkjDark = 0;   // dark engraving pixels in base band
  let goldPixels = 0; // metallic gold pixels
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], a = pixels[i + 3];
      if (a < 10) {
        transparent++;
        continue;
      }
      opaque++;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      // Base band in 100-space is y ~80-92 → scale to 256: y 205-235.
      if (y > 205 && y < 235 && a > 40 && r < 150 && g < 130 && b < 90) mkjDark++;
      // Gold: high R, mid-high G, low B.
      if (a > 40 && r > 150 && g > 110 && g < 200 && b < 110) goldPixels++;
    }
  }
  return {
    transparent,
    opaque,
    bbox: { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY },
    mkjDark,
    goldPixels,
  };
}

let failures = 0;
const bboxes = [];
const results = [];

for (const color of COLORS) {
  for (const type of TYPES) {
    const id = `mkj-piece-${color}${type}`;
    const { pixels } = renderSymbol(id);
    const a = analyze(pixels);
    bboxes.push({ id, ...a.bbox });
    results.push({ id, ...a });
    const problems = [];
    if (a.transparent < 1000) problems.push('too little transparency');
    if (a.opaque < 500) problems.push('too little content');
    if (a.mkjDark < 5) problems.push('MKJ engraving not visible');
    if (a.goldPixels < 20) problems.push('gold accents not visible');
    if (problems.length) failures++;
    console.log(
      `${id.padEnd(18)} opaque=${String(a.opaque).padStart(5)} trans=${String(a.transparent).padStart(5)} ` +
      `bbox=${a.bbox.w}x${a.bbox.h}@(${a.bbox.minX},${a.bbox.minY}) mkj=${a.mkjDark} gold=${a.goldPixels} ` +
      `${problems.length ? 'FAIL: ' + problems.join(', ') : 'ok'}`,
    );
  }
}

// Consistency: all 12 should share the same base width, left centering, and
// baseline (pieces sit on the same y). Total height varies by piece type
// (king tallest, pawn shortest) — that is expected Staunton behaviour.
const widths = bboxes.map((b) => b.w);
const minXs = bboxes.map((b) => b.minX);
const maxYs = bboxes.map((b) => b.maxY + 0); // maxY is absolute; baseline = maxY
const wMin = Math.min(...widths), wMax = Math.max(...widths);
const xMin = Math.min(...minXs), xMax = Math.max(...minXs);
const yMin = Math.min(...maxYs), yMax = Math.max(...maxYs);
console.log(`\nBase width range: ${wMin}–${wMax} (spread ${wMax - wMin})`);
console.log(`Left-edge range: ${xMin}–${xMax} (spread ${xMax - xMin})`);
console.log(`Baseline (maxY) range: ${yMin}–${yMax} (spread ${yMax - yMin})`);
if (wMax - wMin > 5) {
  console.log('FAIL: base widths differ (inconsistent scale)');
  failures++;
} else console.log('ok: base widths consistent');
if (xMax - xMin > 5) {
  console.log('FAIL: left centering differs');
  failures++;
} else console.log('ok: left centering consistent');
if (yMax - yMin > 5) {
  console.log('FAIL: baselines differ (pieces not on same footing)');
  failures++;
} else console.log('ok: baselines consistent');

console.log(`\n${failures === 0 ? 'ALL ARTWORK CHECKS PASSED' : failures + ' ARTWORK CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
