/**
 * MKJ Chess — premium 3D piece asset tests.
 *
 * Validates the generated piece assets structurally (no vision required):
 *   - 12 symbols exist (6 types × 2 colours) in the sprite and inline in HTML
 *   - consistent viewBox, MKJ engraving and gold accents on every piece
 *   - ivory vs obsidian palettes are distinct
 *   - 12 transparent PNG assets are present
 *   - the rejected legacy single-colour symbols are gone
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TYPES = ['pawn', 'rook', 'knight', 'bishop', 'queen', 'king'];
const COLORS = ['w', 'b'];

function read(rel) {
  return readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
}

const sprite = read('assets/pieces-3d.svg');
const html = read('index.html');

function symbolsIn(svg) {
  return [...svg.matchAll(/<symbol\s+id="([^"]+)"[^>]*viewBox="([^"]+)"/g)].map(
    (m) => ({ id: m[1], viewBox: m[2] }),
  );
}

describe('Premium 3D piece assets', () => {
  it('defines exactly 12 colour-aware symbols in the sprite', () => {
    const syms = symbolsIn(sprite);
    assert.equal(syms.length, 12);
    for (const color of COLORS) {
      for (const type of TYPES) {
        assert.ok(
          syms.some((s) => s.id === `mkj-piece-${color}${type}`),
          `missing mkj-piece-${color}${type}`,
        );
      }
    }
  });

  it('uses a consistent 100x100 viewBox on every symbol', () => {
    for (const s of symbolsIn(sprite)) {
      assert.equal(s.viewBox, '0 0 100 100', `${s.id} viewBox`);
    }
  });

  it('engraves MKJ on every piece base', () => {
    const blocks = sprite.match(/<symbol[\s\S]*?<\/symbol>/g) || [];
    assert.equal(blocks.length, 12);
    for (const block of blocks) {
      assert.match(block, /<text[^>]*>MKJ<\/text>/, 'each piece must carry an MKJ engraving');
    }
  });

  it('uses ivory for White and obsidian for Black body gradients', () => {
    assert.match(sprite, /#fdf6e3/, 'white ivory highlight present');
    assert.match(sprite, /#cdb98a/, 'white ivory shading present');
    assert.match(sprite, /#15100a/, 'black obsidian shading present');
    assert.match(sprite, /#6a5a48/, 'black obsidian highlight present');
  });

  it('applies metallic gold accents on every piece', () => {
    const blocks = sprite.match(/<symbol[\s\S]*?<\/symbol>/g) || [];
    for (const block of blocks) {
      assert.match(block, /url\(#[^)]*-gold\)/, 'each piece references a gold gradient');
    }
  });

  it('inlines the same 12 symbols in index.html', () => {
    const htmlSyms = symbolsIn(html).filter((s) => s.id.startsWith('mkj-piece-'));
    assert.equal(htmlSyms.length, 12);
    for (const color of COLORS) {
      for (const type of TYPES) {
        assert.ok(
          htmlSyms.some((s) => s.id === `mkj-piece-${color}${type}`),
          `index.html missing mkj-piece-${color}${type}`,
        );
      }
    }
  });

  it('removes the rejected legacy single-colour symbols', () => {
    for (const type of TYPES) {
      assert.ok(
        !sprite.includes(`id="mkj-piece-${type}" `),
        `legacy mkj-piece-${type} should be gone`,
      );
      assert.ok(
        !html.includes(`id="mkj-piece-${type}" `),
        `legacy mkj-piece-${type} should be gone from HTML`,
      );
    }
  });

  it('ships 12 transparent PNG assets', () => {
    for (const color of COLORS) {
      for (const type of TYPES) {
        const path = new URL(`../assets/pieces/${color}${type}.png`, import.meta.url);
        assert.ok(existsSync(path), `missing ${color}${type}.png`);
        const size = statSync(path).size;
        assert.ok(size > 1000, `${color}${type}.png is suspiciously small (${size} bytes)`);
      }
    }
  });
});
