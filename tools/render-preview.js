/**
 * MKJ Chess — asset preview renderer (build-time only).
 *
 * Renders the premium 3D-style piece sprite to a PNG contact sheet so the
 * vector designs can be inspected visually. Not part of the runtime app.
 * The canonical generator is tools/make-pieces.js; this is a lightweight
 * preview of the same sprite.
 *
 * Usage: node tools/render-preview.js
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const sprite = readFileSync(new URL('../assets/pieces-3d.svg', import.meta.url), 'utf8');
const symbols = sprite.match(/<symbol[\s\S]*?<\/symbol>/g) || [];

const CELL = 180;
const PAD = 20;
const COLS = 6;
const W = COLS * CELL + PAD * 2;
const H = 2 * CELL + PAD * 2;

const uses = symbols
  .map((s, i) => {
    const id = s.match(/id="([^"]+)"/)[1];
    const row = Math.floor(i / COLS);
    const col = i % COLS;
    const x = PAD + col * CELL;
    const y = PAD + row * CELL;
    const sq = row === 0 ? '#e9dcc0' : '#8a7349';
    return `
    <g transform="translate(${x + 15}, ${y + 15})">
      <rect width="${CELL - 30}" height="${CELL - 30}" rx="10" fill="${sq}"/>
      <use href="#${id}" x="0" y="0" width="${CELL - 30}" height="${CELL - 30}"/>
    </g>`;
  })
  .join('\n');

const doc = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#14161c"/>
  ${sprite.replace(/<svg[^>]*>/, '').replace('</svg>', '')}
  ${uses}
</svg>`;

const resvg = new Resvg(doc, { fitTo: { mode: 'width', value: W } });
const png = resvg.render().asPng();
writeFileSync(new URL('../tools/pieces-3d-preview.png', import.meta.url), png);
console.log(`wrote tools/pieces-3d-preview.png (${symbols.length} pieces, ${W}x${H})`);
