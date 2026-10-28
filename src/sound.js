/**
 * MKJ Chess — Sound Engine
 * -----------------------------------------------------------------------------
 * Every sound is synthesized with the Web Audio API. No audio files are
 * shipped, so the app stays small, instant to load and fully offline.
 *
 * Sounds: move, capture, check, promotion, castling, resign, draw, win,
 *         loss, click, timeout.
 */

export class SoundEngine {
  constructor() {
    this.enabled = true;
    this.volume = 0.6;
    this.ctx = null;
    this.master = null;
    this.suspended = false;
  }

  /** Lazily create the AudioContext (browsers require a user gesture). */
  ensureContext() {
    if (typeof window === 'undefined' || !window.AudioContext) return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v || 0));
    if (this.master) this.master.gain.value = this.volume;
  }

  setEnabled(on) {
    this.enabled = Boolean(on);
    if (!this.enabled) this.destroy();
  }

  /**
   * Play a short tone.
   * @param {number} freq Hz
   * @param {number} dur seconds
   * @param {object} opts { type, gain, slideTo, delay, attack }
   */
  tone(freq, dur = 0.12, opts = {}) {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime + (opts.delay || 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const type = opts.type || 'sine';
    const peak = opts.gain != null ? opts.gain : 0.5;
    const attack = opts.attack != null ? opts.attack : 0.006;

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (opts.slideTo) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slideTo), now + dur);
    }

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  /** A short noise burst, used for captures and clock events. */
  noise(dur = 0.09, opts = {}) {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime + (opts.delay || 0);
    const length = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = opts.filter || 'bandpass';
    filter.frequency.value = opts.freq || 1800;
    filter.Q.value = opts.q != null ? opts.q : 1;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(opts.gain != null ? opts.gain : 0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(now);
  }

  /* ==================== Game sounds ==================== */

  move() {
    // Two-tone wood-clock style click.
    this.tone(520, 0.07, { type: 'triangle', gain: 0.42, delay: 0 });
    this.tone(760, 0.05, { type: 'triangle', gain: 0.28, delay: 0.045 });
  }

  capture() {
    this.tone(300, 0.11, { type: 'sawtooth', gain: 0.3, slideTo: 150 });
    this.noise(0.07, { gain: 0.3, freq: 1200 });
  }

  promotion() {
    const base = 523.25; // C5
    [0, 1, 2, 3].forEach((i) =>
      this.tone(base * Math.pow(2, i / 7), 0.16, { type: 'triangle', gain: 0.42, delay: i * 0.085 }),
    );
  }

  check() {
    this.tone(880, 0.1, { type: 'square', gain: 0.3 });
    this.tone(1174.7, 0.14, { type: 'square', gain: 0.26, delay: 0.11 });
  }

  castling() {
    this.tone(330, 0.1, { type: 'sine', gain: 0.36 });
    this.tone(494, 0.12, { type: 'sine', gain: 0.3, delay: 0.1 });
    this.noise(0.06, { gain: 0.16, freq: 900, delay: 0.1 });
  }

  resign() {
    [392, 349.23, 293.66].forEach((f, i) =>
      this.tone(f, 0.22, { type: 'sine', gain: 0.34, delay: i * 0.13 }),
    );
  }

  draw() {
    this.tone(440, 0.16, { type: 'sine', gain: 0.3 });
    this.tone(440, 0.16, { type: 'sine', gain: 0.28, delay: 0.16 });
  }

  win() {
    const base = 523.25;
    [0, 2, 4, 7].forEach((i) =>
      this.tone(base * Math.pow(2, i / 7), 0.24, { type: 'triangle', gain: 0.4, delay: i * 0.11 }),
    );
  }

  loss() {
    const base = 440;
    [0, -3, -5, -8].forEach((i) =>
      this.tone(base * Math.pow(2, i / 7), 0.28, { type: 'sine', gain: 0.34, delay: i * 0.13 }),
    );
  }

  timeout() {
    this.tone(196, 0.3, { type: 'sawtooth', gain: 0.32, slideTo: 110 });
  }

  click() {
    this.tone(660, 0.035, { type: 'square', gain: 0.2 });
  }

  select() {
    this.tone(880, 0.03, { type: 'sine', gain: 0.16 });
  }

  /* ==================== System ==================== */

  destroy() {
    if (this.ctx && this.ctx.close) {
      try { this.ctx.close(); } catch { /* already closed */ }
    }
    this.ctx = null;
    this.master = null;
  }
}

/** One shared instance used by the whole app. */
export const sound = new SoundEngine();
