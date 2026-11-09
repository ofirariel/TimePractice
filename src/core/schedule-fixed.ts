import type { Silence, SilenceUnit } from './schedule-random';

export interface FixedScheduleOptions {
  /** Unit for silence, every and grace. In seconds mode boundaries are rounded to whole beats. */
  unit: SilenceUnit;
  /** How long each silence lasts. */
  silence: number;
  /** Length of one cycle: a silence happens once every this many units, at the end of the cycle. */
  every: number;
  /** Nothing is muted before this point; the first cycle starts here. */
  grace: number;
  bpm: number;
  beatsPerBar: number;
}

function finite(n: number, fallback: number): number {
  return Number.isFinite(n) ? n : fallback;
}

/**
 * "Silence for N every M": each cycle of M plays first, then is silent for its last N.
 * Seconds-mode boundaries are computed from the start each time (not accumulated),
 * so rounding to the beat never makes the pattern drift.
 */
export class FixedSchedule {
  private readonly toBeat: (units: number) => number;
  private readonly graceBeats: number;
  private readonly silence: number;
  private readonly every: number;
  private cycle = 0;
  private lastEnd = -Infinity;

  constructor(opts: FixedScheduleOptions) {
    const bpm = Math.max(1, finite(opts.bpm, 120));
    const beatsPerBar = Math.max(1, Math.round(finite(opts.beatsPerBar, 4)));
    const grace = Math.max(0, finite(opts.grace, 0));
    if (opts.unit === 'bars') {
      this.silence = Math.max(1, Math.round(finite(opts.silence, 1)));
      this.every = Math.max(this.silence + 1, Math.round(finite(opts.every, 2)));
      this.graceBeats = Math.round(grace) * beatsPerBar;
      this.toBeat = (bars) => bars * beatsPerBar;
    } else {
      this.silence = Math.max(0, finite(opts.silence, 1));
      this.every = Math.max(this.silence, finite(opts.every, 2));
      this.graceBeats = Math.ceil((grace * bpm) / 60 - 1e-9);
      this.toBeat = (seconds) => Math.round((seconds * bpm) / 60);
    }
  }

  next(): Silence {
    const cycleStart = this.cycle * this.every;
    this.cycle++;
    // At least one beat of sound before each silence, and each silence at least one beat long.
    const startBeat = Math.max(this.graceBeats + this.toBeat(cycleStart + this.every - this.silence), this.lastEnd + 1);
    const endBeat = Math.max(this.graceBeats + this.toBeat(cycleStart + this.every), startBeat + 1);
    this.lastEnd = endBeat;
    return { startBeat, endBeat };
  }
}
