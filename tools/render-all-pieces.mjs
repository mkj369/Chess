/**
 * Render all 12 piece types from the actual inlined sprite using resvg.
 * Verifies that pieces render as solid shapes (not wireframes).
 */
import { Resvg } from '@resvg/resvg-js';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf-8');

// Extract the sprite SVG from index.html
const spriteMatch = html.match(/<svg[^>]*style="display:none"[^>]*>([\s\S]*?)<\/svg>/);
if (!spriteMatch) {
  console.log('ERROR: Could not find sprite SVG in index.html');
  process.exit(1);
}

const spriteSvg = spriteMatch[0];

// Verify sprite has 12 piece symbols
const pieceSymbols = spriteSvg.match(/<symbol[^>]*id="mkj-piece-[^"]*"/g);
console.log(`Sprite has ${pieceSymbols ? pieceSymbols.length : 0} piece symbols`);

// Verify sprite has gradients
const gradients = spriteSvg.match(/<linearGradient[^>]*id="[^"]*-body"/g);
console.log(`Sprite has ${gradients ? gradients.length : 0} body gradients`);

// Build a test SVG with all 12 pieces arranged in a 4x3 grid
const pieceTypes = [
  'wpawn', 'wpawn', 'wknight', 'wbishop', 'wrook', 'wqueen', 'wking',
  'bpawn', 'bpawn', 'bknight', 'bbishop', 'brook', 'bqueen', 'bking',
];

// Actually, let's just render each piece type individually for clear results
const allPieces = [
  'wpawn', 'wknight', 'wbishop', 'wrook', 'wqueen', 'wking',
  'bpawn', 'bknight', 'bbishop', 'brook', 'bqueen', 'bking',
];

let allSolid = true;

for (const piece of allPieces) {
  // Build test SVG: sprite + single use element
  const testSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  ${spriteSvg}
  <svg x="10" y="10" width="180" height="180" viewBox="0 0 100 100">
    <use href="#mkj-piece-${piece}" />
  </svg>
</svg>`;

  const resvg = new Resvg(testSvg, {
    fitTo: { mode: 'width', value: 200 },
  });
  const png = resvg.render().asPng();

  // Analyze the PNG for solid fills
  // Count non-transparent pixels and check for variety
  const rendered = resvg.render();
  const pixels = rendered.pixels;
  // rawPixels is a Uint8Array of RGBA
  let opaqueCount = 0;
  let transparentCount = 0;
  const colorSet = new Set();

  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3];
    if (alpha > 0) {
      opaqueCount++;
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      // Quantize to reduce noise
      colorSet.add(`${r >> 4},${g >> 4},${b >> 4}`);
    } else {
      transparentCount++;
    }
  }

  const totalPixels = pixels.length / 4;
  const opaqueRatio = opaqueCount / totalPixels;
  const isSolid = opaqueRatio > 0.1 && colorSet.size > 3; // at least 10% opaque and 4+ distinct colors

  // Check for warm ivory (white pieces) or dark (black pieces)
  let hasWarmFill = false;
  let hasDarkFill = false;
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3];
    if (alpha > 128) {
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      if (r > 200 && g > 180 && b > 150) hasWarmFill = true; // warm ivory
      if (r < 100 && g < 100 && b < 100) hasDarkFill = true; // dark
    }
  }

  const fillType = piece.startsWith('w') ? (hasWarmFill ? 'warm' : '?') : (hasDarkFill ? 'dark' : '?');
  console.log(`  ${piece}: opaque=${(opaqueRatio * 100).toFixed(1)}%, colors=${colorSet.size}, fill=${fillType} ${isSolid ? '✓ SOLID' : '✗ THIN'}`);

  if (!isSolid) allSolid = false;
}

console.log(`\n================ RESULTS ================`);
console.log(allSolid ? 'ALL PIECES RENDER SOLID ✓' : 'SOME PIECES ARE THIN ✗');
if (!allSolid) process.exit(1);
