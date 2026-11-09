import { createRng, randFloat, randInt, type Rng } from './rng';

export type SilenceUnit = 'bars' | 'seconds';

export interface Range {
  min: number;
  max: number;
}

export interface RandomScheduleOptions {
  /** Unit for length, gap and grace. In seconds mode values are rounded to whole beats. */
  unit: SilenceUnit;
  /** How long each silence lasts. Use min === max for a fixed length. */
  length: Range;
  /** How long the sound plays between silences. Use min === max for a fixed gap. */
  gap: Range;
  /** Chance (0–1) that a silence starts on any given bar once the gap is over. 1 = always. */
  chance: number;
  /** Nothing is muted before this point. */
  grace: number;
  bpm: number;
  beatsPerBar: number;
  seed: string | number;
}

/** A silence in absolute beat indices; `endBeat` is exclusive (the beat where sound returns). */
export interface Silence {
  startBeat: number;
  endBeat: number;
}

interface BeatRange {
  min: number;
  max: number;
}

interface Normalized {
  unit: SilenceUnit;
  length: BeatRange;
  gap: BeatRange;
  chance: number;
  graceBeats: number;
  beatsPerBar: number;
  bpm: number;
}

const MIN_CHANCE = 0.01;

function finite(n: number, fallback: number): number {
  return Number.isFinite(n) ? n : fallback;
}

function orderedRange(r: Range, floor: number): Range {
  const a = Math.max(floor, finite(r.min, floor));
  const b = Math.max(floor, finite(r.max, a));
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

function normalize(opts: RandomScheduleOptions): Normalized {
  const beatsPerBar = Math.max(1, Math.round(finite(opts.beatsPerBar, 4)));
  const bpm = Math.max(1, finite(opts.bpm, 120));
  const chance = Math.min(1, Math.max(MIN_CHANCE, finite(opts.chance, 1)));
  if (opts.unit === 'bars') {
    const length = orderedRange(opts.length, 1);
    const gap = orderedRange(opts.gap, 1);
    return {
      unit: 'bars',
      length: { min: Math.round(length.min), max: Math.round(length.max) },
      gap: { min: Math.round(gap.min), max: Math.round(gap.max) },
      chance,
      graceBeats: Math.max(0, Math.round(finite(opts.grace, 0))) * beatsPerBar,
      beatsPerBar,
      bpm,
    };
  }
  // Seconds: keep the ranges in seconds, convert each draw to whole beats so mutes stay on the beat.
  return {
    unit: 'seconds',
    length: orderedRange(opts.length, 0),
    gap: orderedRange(opts.gap, 0),
    chance,
    // Round up so that nothing is ever muted inside the grace period.
    graceBeats: Math.max(0, Math.ceil((finite(opts.grace, 0) * bpm) / 60 - 1e-9)),
    beatsPerBar,
    bpm,
  };
}

/**
 * An endless, deterministic stream of silences. The same options (including seed)
 * always produce the same sequence, so a session can be repeated exactly.
 */
export class RandomSchedule {
  private readonly o: Normalized;
  private readonly rng: Rng;
  private cursor: number;

  constructor(opts: RandomScheduleOptions) {
    this.o = normalize(opts);
    this.rng = createRng(opts.seed);
    this.cursor = this.o.graceBeats;
  }

  private draw(range: BeatRange): number {
    if (this.o.unit === 'bars') return randInt(this.rng, range.min, range.max) * this.o.beatsPerBar;
    const seconds = randFloat(this.rng, range.min, range.max);
    return Math.max(1, Math.round((seconds * this.o.bpm) / 60));
  }

  next(): Silence {
    while (this.rng() >= this.o.chance) this.cursor += this.o.beatsPerBar;
    const startBeat = this.cursor;
    const endBeat = startBeat + this.draw(this.o.length);
    this.cursor = endBeat + this.draw(this.o.gap);
    return { startBeat, endBeat };
  }
}

/** All silences that start before `untilBeat`. */
export function generateRandomSchedule(opts: RandomScheduleOptions, untilBeat: number): Silence[] {
  const schedule = new RandomSchedule(opts);
  const out: Silence[] = [];
  for (;;) {
    const s = schedule.next();
    if (s.startBeat >= untilBeat) return out;
    out.push(s);
  }
}
