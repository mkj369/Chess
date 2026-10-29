/**
 * MKJ Chess — promotion modal regression tests (jsdom).
 *
 * Verifies the fix for the bug where the promotion modal appeared over the
 * home screen on initial page load. Root cause: the modal's HTML had
 * `is-hidden` as a bare attribute instead of a CSS class, so the
 * `.mkj-promotion.is-hidden { display: none }` rule never applied.
 *
 * Also verifies the modal opens only for a genuine pawn-promotion event and
 * closes after a valid choice, with the promoted piece rendered correctly.
 *
 * Run: npm test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost:5173/', pretendToBeVisual: true });
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
try {
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
} catch { /* Node's navigator is fine */ }
globalThis.location = window.location;
globalThis.localStorage = window.localStorage;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.Event = window.Event;
globalThis.CustomEvent = window.CustomEvent;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);

const { boot } = await import('../src/app.js');
await boot();

const doc = window.document;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROMO_FEN = '8/4P3/8/8/8/8/8/4K2k w - - 0 1'; // white pawn on e7

function modal() {
  return doc.getElementById('mkj-promotion');
}
function clickSq(sq) {
  const el = doc.querySelector(`#mkj-board .mkj-sq[data-sq="${sq}"]`);
  if (el) el.click();
  return !!el;
}
function findButton(text) {
  return Array.from(doc.querySelectorAll('button')).find((b) => b.textContent.includes(text));
}

describe('promotion modal — hidden on startup', () => {
  it('has the is-hidden class and aria-hidden on initial page load', () => {
    const m = modal();
    assert.ok(m, 'modal element exists');
    assert.ok(m.classList.contains('is-hidden'), 'modal has is-hidden class');
    assert.equal(m.getAttribute('aria-hidden'), 'true');
  });

  it('does not open during boot or home-screen rendering', () => {
    const active = doc.querySelector('.mkj-screen.is-active');
    assert.equal(active?.id, 'mkj-screen-home', 'home screen is active');
    assert.ok(modal().classList.contains('is-hidden'), 'modal still hidden on home screen');
  });
});

describe('promotion modal — stays hidden for non-promotion events', () => {
  it('stays hidden after starting a local game', async () => {
    doc.getElementById('mkj-btn-play')?.click();
    await sleep(50);
    findButton('Start local game')?.click();
    await sleep(50);
    const pieces = doc.querySelectorAll('#mkj-board .mkj-piece').length;
    assert.equal(pieces, 32, '32 pieces rendered');
    assert.ok(modal().classList.contains('is-hidden'), 'modal hidden after local game start');
  });

  it('stays hidden after an ordinary legal move (e2-e4)', async () => {
    clickSq(12); // e2
    await sleep(10);
    clickSq(28); // e4
    await sleep(20);
    assert.ok(modal().classList.contains('is-hidden'), 'modal hidden after non-promotion move');
  });
});

describe('promotion modal — opens only for genuine promotion', () => {
  it('opens when a pawn legally reaches its promotion rank', async () => {
    // Return to the mode screen and load a practice position with a pawn on e7.
    doc.getElementById('mkj-gb-new')?.click();
    await sleep(50);
    const fenInput = doc.getElementById('mkj-inp-fen');
    assert.ok(fenInput, 'FEN input found on mode screen');
    fenInput.value = PROMO_FEN;
    findButton('Open practice board')?.click();
    await sleep(50);

    // Before the promotion move, the modal must be hidden.
    assert.ok(modal().classList.contains('is-hidden'), 'modal hidden before promotion move');

    // Select the e7 pawn and move it to e8 (promotion).
    assert.ok(clickSq(52), 'e7 square clickable');
    await sleep(10);
    assert.ok(clickSq(60), 'e8 square clickable');
    await sleep(60);

    // The modal must now be visible.
    assert.ok(!modal().classList.contains('is-hidden'), 'modal opens for genuine promotion');
    assert.equal(modal().getAttribute('aria-hidden'), 'false');
    const choices = modal().querySelectorAll('.mkj-promotion__choice');
    assert.equal(choices.length, 4, 'modal shows 4 promotion choices (Q, R, B, N)');
  });

  it('closes after a valid choice and applies the promoted piece', async () => {
    const m = modal();
    const choices = m.querySelectorAll('.mkj-promotion__choice');
    // Choose queen (first choice).
    choices[0].click();
    await sleep(60);

    // The modal must close.
    assert.ok(m.classList.contains('is-hidden'), 'modal closes after valid choice');
    assert.equal(m.getAttribute('aria-hidden'), 'true');

    // The pawn on e8 must now render as a white queen.
    const e8 = doc.querySelector('#mkj-board .mkj-piece[data-sq="60"]');
    assert.ok(e8, 'a piece exists on e8');
    const use = e8.querySelector('use');
    assert.ok(use, 'piece has a use element');
    assert.equal(use.getAttribute('href'), '#mkj-piece-wqueen', 'pawn promoted to queen visually');
  });
});
