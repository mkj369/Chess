/**
 * MKJ Chess — premium 3D-style Staunton piece asset generator (build-time only).
 *
 * Produces:
 *   assets/pieces-3d.svg        inline sprite (12 symbols: 6 types × 2 colours)
 *   assets/pieces/w{type}.png   transparent 256×256 raster for each white piece
 *   assets/pieces/b{type}.png   transparent 256×256 raster for each black piece
 *   tools/pieces-3d-preview.png contact sheet for visual reference
 *
 * Design language
 *   Every piece shares one base pedestal with a gold inlay ring and an engraved
 *   "MKJ" monogram, a vertical body gradient (warm ivory for White, deep
 *   obsidian for Black), a top-left highlight and a bottom-right shadow to read
 *   as 2.5D, plus metallic-gold accents. Lighting direction is identical across
 *   all 12 pieces so the set is visually consistent.
 *
 * This is a deterministic vector pipeline (no third-party models), so it is
 * fully offline and carries no licensing risk. Real-time WebGL 3D was assessed
 * and rejected: it would require shipping a 3D engine + GLTF models, breaks the
 * fully-offline constraint, and cannot be verified in this environment.
 *
 * Usage: node tools/make-pieces.js
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const VB = 100;

/* ------------------------------------------------------------------ palettes */

const PALETTES = {
  // White — warm ivory / light wood.
  w: {
    light: '#fdf6e3',
    mid: '#efe3c4',
    dark: '#cdb98a',
    edge: '#8a7349',
    goldLight: '#f7e08a',
    gold: '#d4af37',
    goldDark: '#8a6a12',
  },
  // Black — deep obsidian / dark wood.
  b: {
    light: '#6a5a48',
    mid: '#2e2618',
    dark: '#15100a',
    edge: '#0a0604',
    goldLight: '#f7e08a',
    gold: '#d4af37',
    goldDark: '#8a6a12',
  },
};

const TYPES = ['pawn', 'rook', 'knight', 'bishop', 'queen', 'king'];

/* --------------------------------------------------------------- gradients */

function gradients(p, id) {
  return `
    <linearGradient id="${id}-body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${p.light}"/>
      <stop offset="0.5" stop-color="${p.mid}"/>
      <stop offset="1" stop-color="${p.dark}"/>
    </linearGradient>
    <linearGradient id="${id}-gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${p.goldLight}"/>
      <stop offset="0.5" stop-color="${p.gold}"/>
      <stop offset="1" stop-color="${p.goldDark}"/>
    </linearGradient>
    <radialGradient id="${id}-hi" cx="0.4" cy="0.32" r="0.62">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.6"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="${id}-sh" cx="0.68" cy="0.8" r="0.5">
      <stop offset="0" stop-color="#000000" stop-opacity="0.4"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
  `;
}

/* --------------------------------------------------------------------- base */

function base(p, id) {
  return `
    <ellipse cx="50" cy="91.5" rx="33" ry="5.5" fill="#000000" opacity="0.22"/>
    <rect x="16" y="80" width="68" height="12" rx="6" fill="url(#${id}-body)" stroke="${p.edge}" stroke-width="1.5"/>
    <rect x="20" y="73" width="60" height="9" rx="4.5" fill="url(#${id}-body)" stroke="${p.edge}" stroke-width="1.5"/>
    <rect x="20" y="73.4" width="60" height="2.2" fill="url(#${id}-gold)"/>
    <text x="50" y="87.5" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-size="8" font-weight="700" letter-spacing="1.5" fill="${p.goldDark}">MKJ</text>
  `;
}

/* ------------------------------------------------------------------- pieces */

const PIECES = {
  pawn: (p, id) => `
    <circle cx="50" cy="30" r="13" fill="url(#${id}-body)" stroke="${p.edge}" stroke-width="1.5"/>
    <path d="M43 43 Q50 46 57 43 L59 51 Q50 54 41 51 Z" fill="url(#${id}-body)" stroke="${p.edge}" stroke-width="1.5"/>
    <path d="M44 51 L41 73 L59 73 L56 51 Z" fill="url(#${id}-body)" stroke="${p.edge}" stroke-width="1.5"/>
    <ellipse cx="50" cy="47.5" rx="9.5" ry="2.6" fill="url(#${id}-gold)" opacity="0.95"/>
    <ellipse cx="45" cy="25" rx="6" ry="4.5" fill="url(#${id}-hi)"/>
    <path d="M52 17 A13 13 0 0 1 52 43 A9 9 0 0 0 52 27 Z" fill="#000000" opacity="0.14"/>
    ${base(p, id)}
  `,

  rook: (p, id) => `
    <path d="M33 40 L67 40 L63 73 L37 73 Z" fill="url(#${id}-body)" stroke="${p.edge}" stroke-width="1.5"/>
    <rect x="34" y="28" width="9" height="12" rx="1.5" fill="url(#${id}-body)" stroke="${p.edge}" stroke-width="1.5"/>
    <rect x="45.5" y="26" width="9" height="14" rx="1.5" fill="url(#${id}-body)" stroke="${p.edge}" stroke-width="1.5"/>
    <rect x="57" y="28" width="9" height="12" rx="1.5" fill="url(#${id}-body)" stroke="${p.edge}" stroke-width="1.5"/>
    <rect x="35" y="41" width="30" height="3" rx="1.5" fill="url(#${id}-gold)"/>
    <rect x="36" y="44" width="8" height="26" rx="3" fill="url(#${id}-hi)"/>
    ${base(p, id)}
  `,

  knight: (p, id) => `
    <path d="M40 73 L42 42 C42 38 45 36 49 36 C53 36 56 38 56 42 L58 73 Z" fill="url(#${id}-body)" stroke="${p.edge}" stroke-width="1.5"/>
    <path d="M56 36 C56 32 53 29 49 29 C45 29 42 32 42 36 C42 39 39 41 35 42 C31 43 28 46 28 50 C28 53 31 55 35 55 C39 55 42 53 44 51 L52 45 C54 43 56 41 57 39 C58 37 58 36 56 36 Z" fill="url(#${id}-body)" stroke="${p.edge}" stroke-width="1.5"/>
    <path d="M52 29 L55 25 L57 30 Z" fill="url(#${id}-body)" stroke="${p.edge}" stroke-width="1.5"/>
    <path d="M56 36 C59 38 60 42 58 45 C60 43 61 40 60 37 Z" fill="${p.dark}" opacity="0.5"/>
    <circle cx="44" cy="40" r="1.8" fill="${p.edge}"/>
    <path d="M53 28 L55 26 L56 29 Z" fill="url(#${id}-gold)"/>
    <ellipse cx="48" cy="33" rx="5" ry="3.5" fill="url(#${id}-hi)"/>
    ${base(p, id)}
  `,

  bishop: (p, id) => `
    <path d="M50 15 C39 15 32 24 32 33 C32 41 39 47 50 47 C61 47 68 41 68 33 C68 24 61 15 50 15 Z" fill="url(#${id}-body)" stroke="${p.edge}" stroke-width="1.5"/>
    <path d="M50 19 L46 38 L54 38 Z" fill="${p.edge}" opacity="0.55"/>
    <path d="M40 47 L60 47 L58 55 L42 55 Z" fill="url(#${id}-body)" stroke="${p.edge}" stroke-width="1.5"/>
    <path d="M44 55 L42 73 L58 73 L56 55 Z" fill="url(#${id}-body)" stroke="${p.edge}" stroke-width="1.5"/>
    <ellipse cx="50" cy="51" rx="9.5" ry="2.6" fill="url(#${id}-gold)" opacity="0.95"/>
    <circle cx="50" cy="15" r="3" fill="url(#${id}-gold)" stroke="${p.edge}" stroke-width="1"/>
    <ellipse cx="44" cy="27" rx="6" ry="8" fill="url(#${id}-hi)"/>
    ${base(p, id)}
  `,

  queen: (p, id) => `
    <path d="M36 38 L64 38 L60 73 L40 73 Z" fill="url(#${id}-body)" stroke="${p.edge}" stroke-width="1.5"/>
    <rect x="33" y="30" width="34" height="9" rx="2" fill="url(#${id}-body)" stroke="${p.edge}" stroke-width="1.5"/>
    <circle cx="36" cy="28" r="3.5" fill="url(#${id}-gold)" stroke="${p.edge}" stroke-width="1"/>
    <circle cx="44.5" cy="25" r="4" fill="url(#${id}-gold)" stroke="${p.edge}" stroke-width="1"/>
    <circle cx="50" cy="23" r="4.5" fill="url(#${id}-gold)" stroke="${p.edge}" stroke-width="1"/>
    <circle cx="55.5" cy="25" r="4" fill="url(#${id}-gold)" stroke="${p.edge}" stroke-width="1"/>
    <circle cx="64" cy="28" r="3.5" fill="url(#${id}-gold)" stroke="${p.edge}" stroke-width="1"/>
    <rect x="38" y="40" width="24" height="3" rx="1.5" fill="url(#${id}-gold)"/>
    <ellipse cx="44" cy="34" rx="6" ry="14" fill="url(#${id}-hi)"/>
    ${base(p, id)}
  `,

  king: (p, id) => `
    <path d="M36 42 L64 42 L60 73 L40 73 Z" fill="url(#${id}-body)" stroke="${p.edge}" stroke-width="1.5"/>
    <path d="M34 42 L66 42 L64 34 L36 34 Z" fill="url(#${id}-body)" stroke="${p.edge}" stroke-width="1.5"/>
    <rect x="36" y="30" width="5" height="5" rx="1" fill="url(#${id}-gold)"/>
    <rect x="47.5" y="28" width="5" height="7" rx="1" fill="url(#${id}-gold)"/>
    <rect x="59" y="30" width="5" height="5" rx="1" fill="url(#${id}-gold)"/>
    <rect x="48" y="6" width="4" height="16" rx="1.5" fill="url(#${id}-gold)" stroke="${p.edge}" stroke-width="1"/>
    <rect x="42" y="9" width="16" height="4" rx="1.5" fill="url(#${id}-gold)" stroke="${p.edge}" stroke-width="1"/>
    <rect x="40" y="44" width="20" height="3" rx="1.5" fill="url(#${id}-gold)"/>
    <ellipse cx="44" cy="38" rx="6" ry="14" fill="url(#${id}-hi)"/>
    ${base(p, id)}
  `,
};

/* ------------------------------------------------------------- assemble svg */

function symbol(type, color) {
  const id = `${color}${type}`;
  const p = PALETTES[color];
  return `    <symbol id="mkj-piece-${id}" viewBox="0 0 ${VB} ${VB}">
      ${PIECES[type](p, id)}
    </symbol>`;
}

function spriteSvg() {
  // All gradients live in one top-level <defs> so url(#id) references resolve
  // globally when a symbol is cloned via <use>.
  const grads = TYPES.flatMap((t) =>
    ['w', 'b'].map((c) => gradients(PALETTES[c], `${c}${t}`)),
  ).join('\n');
  const symbols = TYPES.flatMap((t) => [symbol(t, 'w'), symbol(t, 'b')]).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
${grads}
${symbols}
  </defs>
</svg>
`;
}

function standaloneSvg(type, color) {
  const id = `${color}${type}`;
  const p = PALETTES[color];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB} ${VB}" width="${VB}" height="${VB}">
  <defs>${gradients(p, id)}</defs>
  ${PIECES[type](p, id)}
</svg>`;
}

/* ------------------------------------------------------------------ output */

function renderPng(svg, size) {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
  return resvg.render().asPng();
}

function main() {
  const root = new URL('..', import.meta.url);
  const assetsDir = new URL('assets/', root);
  const piecesDir = new URL('assets/pieces/', root);
  mkdirSync(piecesDir, { recursive: true });

  // 1. Sprite file.
  writeFileSync(new URL('assets/pieces-3d.svg', root), spriteSvg(), 'utf8');

  // 2. Individual transparent PNGs.
  const SIZE = 256;
  for (const color of ['w', 'b']) {
    for (const type of TYPES) {
      const svg = standaloneSvg(type, color);
      const png = renderPng(svg, SIZE);
      writeFileSync(new URL(`assets/pieces/${color}${type}.png`, root), png);
    }
  }

  // 3. Contact-sheet preview.
  const CELL = 180;
  const PAD = 20;
  const COLS = 6;
  const W = COLS * CELL + PAD * 2;
  const H = 2 * CELL + PAD * 2;
  const cells = TYPES.flatMap((t, i) => {
    const row = Math.floor(i / COLS);
    const col = i % COLS;
    const x = PAD + col * CELL;
    const y = PAD + row * CELL;
    const sq = (row === 0 ? '#e9dcc0' : '#8a7349');
    const w = `<g transform="translate(${x + 15}, ${y + 15})">
      <rect width="${CELL - 30}" height="${CELL - 30}" rx="10" fill="${sq}"/>
      <use href="#mkj-piece-w${t}" x="0" y="0" width="${CELL - 30}" height="${CELL - 30}"/>
    </g>`;
    const b = `<g transform="translate(${x + 15}, ${y + 15})">
      <rect width="${CELL - 30}" height="${CELL - 30}" rx="10" fill="${sq}"/>
      <use href="#mkj-piece-b${t}" x="0" y="0" width="${CELL - 30}" height="${CELL - 30}"/>
    </g>`;
    return [w, b];
  }).join('\n');
  const preview = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#14161c"/>
  <defs>${TYPES.flatMap((t) => ['w', 'b'].map((c) => gradients(PALETTES[c], `${c}${t}`))).join('')}${TYPES.flatMap((t) => [symbol(t, 'w'), symbol(t, 'b')]).join('')}</defs>
  ${cells}
</svg>`;
  writeFileSync(new URL('tools/pieces-3d-preview.png', root), renderPng(preview, W));

  console.log(`wrote assets/pieces-3d.svg (${TYPES.length * 2} symbols)`);
  console.log(`wrote ${TYPES.length * 2} PNGs in assets/pieces/ (${SIZE}×${SIZE})`);
  console.log('wrote tools/pieces-3d-preview.png');
}

main();
