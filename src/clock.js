/**
 * MKJ Chess — Chess Clocks
 * -----------------------------------------------------------------------------
 * Optional time controls with increment, per-side timings and timeout handling.
 * Used by both local 1v1 and computer games.
 */

export const WHITE = 'w';
export const BLACK = 'b';

/**
 * Time control presets. `initial` and `increment` are in seconds.
 */
export const TIME_CONTROLS = {
  '1-0': { initial: 60, increment: 0, label: 'Bullet 1+0', tag: 'Bullet' },
  '2-1': { initial: 120, increment: 1, label: 'Bullet 2+1', tag: 'Bullet' },
  '3-0': { initial: 180, increment: 0, label: 'Blitz 3+0', tag: 'Blitz' },
  '3-2': { initial: 180, increment: 2, label: 'Blitz 3+2', tag: 'Blitz' },
  '5-0': { initial: 300, increment: 0, label: 'Blitz 5+0', tag: 'Blitz' },
  '10-0': { initial: 600, increment: 0, label: 'Rapid 10+0', tag: 'Rapid' },
  '15-10': { initial: 900, increment: 10, label: 'Rapid 15+10', tag: 'Rapid' },
};

export const CUSTOM_LABEL = 'Custom';

/** Normalise a user-entered custom control such as "25-10" or "15+10". */
export function parseCustomTimeControl(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  s = s.replace(/[+x:]/g, '-').replace(/^-+|-+$/g, '');
  const parts = s.split('-');
  if (parts.length !== 2) return null;
  const initial = Number(parts[0]);
  const increment = Number(parts[1]);
  if (!Number.isFinite(initial) || !Number.isFinite(increment)) return null;
  if (!(initial > 0) && !(increment > 0)) return null;
  if (initial < 0 || increment < 0) return null;
  return {
    initial: Math.min(initial, 24 * 60 * 60), // cap at 24h to reject nonsense values
    increment: Math.min(increment, 3600),
    label: `${Math.round(initial)}+${Math.round(increment)}`,
    tag: 'Custom',
  };
}

/** Return a canonical control for a settings value, or null when disabled. */
export function resolveTimeControl(settingsValue, customRaw) {
  if (!settingsValue || settingsValue === 'none') return null;
  if (settingsValue === CUSTOM_LABEL) return parseCustomTimeControl(customRaw);
  return TIME_CONTROLS[settingsValue] || null;
}

/** Format a number of seconds as m:ss or h:mm:ss. */
export function formatSeconds(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '0:00';
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * A two-sided chess clock.
 *
 * Time accounting keeps `elapsed[color]` (seconds used) and derives
 * `remaining[color]` from it, so awarding an increment is just subtracting from
 * elapsed time. The controller calls `start()`, `setTurn(color)`, `tick()` on
 * a timer, `awardIncrement(color)` after a move and `stop()` when paused.
 */
export class Clock {
  /**
   * @param {object} options
   * @param {{white:object,black:object}} options.controls per-side { initial, increment }
   * @param {Function} [options.onTick] called with a snapshot after each tick
   * @param {Function} [options.onTimeout] called once with the colour that ran out
   */
  constructor(options = {}) {
    this.controls = options.controls || null;
    this.onTick = options.onTick || (() => {});
    this.onTimeout = options.onTimeout || (() => {});
    this.remaining = { [WHITE]: 0, [BLACK]: 0 };
    this.elapsed = { [WHITE]: 0, [BLACK]: 0 };
    this.active = null;
    this.startedAt = 0;
    this.enabled = Boolean(this.controls);
    this.firedTimeout = false;

    if (this.enabled) {
      for (const color of [WHITE, BLACK]) {
        const ctrl = this.controls[color];
        this.remaining[color] = ctrl ? ctrl.initial : 0;
      }
    }
  }

  /** Begin running. Nothing is deducted until a colour has the move. */
  start() {
    this.firedTimeout = false;
  }

  /** Mark `color` as the side to move and start timing it. */
  setTurn(color) {
    if (!this.enabled) return;
    this.active = color;
    this.startedAt = Date.now();
  }

  /** Advance the clock by the elapsed time of the active colour. */
  tick() {
    if (!this.enabled || this.firedTimeout) return;
    if (!this.active || !this.startedAt) return;

    const deltaSeconds = (Date.now() - this.startedAt) / 1000;
    if (deltaSeconds <= 0) return;

    this.elapsed[this.active] += deltaSeconds;
    this.startedAt = Date.now();
    this.remaining[this.active] = Math.max(
      0,
      this.controls[this.active].initial - this.elapsed[this.active],
    );

    this.onTick(this.snapshot());

    if (this.remaining[this.active] <= 0) {
      this.stop();
      this.firedTimeout = true;
      this.onTimeout(this.active);
    }
  }

  /** Award the increment to the colour that just moved. */
  awardIncrement(color) {
    if (!this.enabled) return;
    const ctrl = this.controls[color];
    if (!ctrl || !ctrl.increment) return;
    this.elapsed[color] = Math.max(0, this.elapsed[color] - ctrl.increment);
    this.remaining[color] = Math.max(0, ctrl.initial - this.elapsed[color]);
    this.onTick(this.snapshot());
  }

  /** Penalise a colour by a number of seconds (used for out-of-turn moves). */
  penalise(color, seconds) {
    if (!this.enabled || seconds <= 0) return;
    this.elapsed[color] += seconds;
    this.remaining[color] = Math.max(0, this.controls[color].initial - this.elapsed[color]);
    this.onTick(this.snapshot());
  }

  /** Stop timing; the clock resumes with setTurn(). */
  stop() {
    this.startedAt = 0;
    this.active = null;
  }

  /** Restore a clock from a snapshot (used by undo). */
  restore(snapshot) {
    if (!snapshot) return;
    this.remaining = { ...this.remaining, ...snapshot.remaining };
    this.elapsed = { ...this.elapsed, ...snapshot.elapsed };
    this.active = snapshot.active ?? null;
    this.startedAt = snapshot.startedAt ?? 0;
    this.onTick(this.snapshot());
  }

  /** A plain, serialisable snapshot of the current clock state. */
  snapshot() {
    return {
      enabled: this.enabled,
      remaining: { ...this.remaining },
      elapsed: { ...this.elapsed },
      active: this.active,
      startedAt: this.startedAt,
    };
  }

  isOut(color) {
    return this.enabled && this.remaining[color] <= 0;
  }

  minimumSeconds() {
    return Math.min(this.remaining[WHITE], this.remaining[BLACK]);
  }

  destroy() {
    this.stop();
  }
}
