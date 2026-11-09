import type { ScheduleOptions } from '../core/schedule';
import type { Range, SilenceUnit } from '../core/schedule-random';
import { BEAT_LEVEL_ORDER, CLICK_SOUNDS, type BeatLevel, type ClickSound } from '../sources/click-sounds';

/** Values kept separately per unit, so switching bars <-> seconds doesn't turn "2 bars" into "2 seconds". */
export interface UnitValues {
  length: Range;
  lengthRanged: boolean;
  gap: Range;
  gapRanged: boolean;
  grace: number;
  /** Fixed mode: silent for `silence` at the end of every `every`. */
  fixed: { silence: number; every: number };
}

export type SilenceMode = 'fixed' | 'random' | 'off';

export interface Settings {
  bpm: number;
  beatsPerBar: number;
  beatUnit: number;
  /**
   * Level of every possible beat (index 0 = the "1"), always LIMITS.beatsPerBar.max long,
   * so a pattern survives switching to a shorter time signature and back.
   */
  beatLevels: BeatLevel[];
  sound: ClickSound;
  /** 0–1 */
  volume: number;
  silence: {
    mode: SilenceMode;
    unit: SilenceUnit;
    bars: UnitValues;
    seconds: UnitValues;
    /** Percent (1–100) chance per bar that a silence starts once the gap is over. */
    chance: number;
    /** Empty = a new random seed every session. */
    seed: string;
  };
}

export const LIMITS = {
  bpm: { min: 20, max: 400 },
  beatsPerBar: { min: 1, max: 15 },
  beatUnits: [2, 4, 8, 16],
  bars: { min: 1, max: 64 },
  seconds: { min: 0.5, max: 120 },
  graceBars: { min: 0, max: 64 },
  graceSeconds: { min: 0, max: 300 },
  chance: { min: 1, max: 100 },
} as const;

export const DEFAULT_SETTINGS: Settings = {
  bpm: 100,
  beatsPerBar: 4,
  beatUnit: 4,
  beatLevels: ['accent', ...Array<BeatLevel>(LIMITS.beatsPerBar.max - 1).fill('normal')],
  sound: 'classic',
  volume: 0.8,
  silence: {
    mode: 'fixed',
    unit: 'bars',
    bars: {
      length: { min: 1, max: 2 }, lengthRanged: true, gap: { min: 2, max: 4 }, gapRanged: true, grace: 4,
      fixed: { silence: 2, every: 4 },
    },
    seconds: {
      length: { min: 2, max: 4 }, lengthRanged: true, gap: { min: 4, max: 8 }, gapRanged: true, grace: 8,
      fixed: { silence: 4, every: 8 },
    },
    chance: 100,
    seed: '',
  },
};

const STORAGE_KEY = 'timepractice.settings.v1';

function num(value: unknown, fallback: number, min: number, max: number, integer = false): number {
  let n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  if (integer) n = Math.round(n);
  return Math.min(max, Math.max(min, n));
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function sanitizeRange(value: unknown, fallback: Range, min: number, max: number, integer: boolean): Range {
  const v = obj(value);
  const a = num(v.min, fallback.min, min, max, integer);
  const b = num(v.max, fallback.max, min, max, integer);
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

function sanitizeUnit(value: unknown, fallback: UnitValues, unit: SilenceUnit): UnitValues {
  const v = obj(value);
  const integer = unit === 'bars';
  const lim = integer ? LIMITS.bars : LIMITS.seconds;
  const grace = integer ? LIMITS.graceBars : LIMITS.graceSeconds;
  return {
    length: sanitizeRange(v.length, fallback.length, lim.min, lim.max, integer),
    lengthRanged: bool(v.lengthRanged, fallback.lengthRanged),
    gap: sanitizeRange(v.gap, fallback.gap, lim.min, lim.max, integer),
    gapRanged: bool(v.gapRanged, fallback.gapRanged),
    grace: num(v.grace, fallback.grace, grace.min, grace.max, integer),
    fixed: sanitizeFixed(v.fixed, fallback.fixed, unit),
  };
}

function sanitizeFixed(value: unknown, fallback: UnitValues['fixed'], unit: SilenceUnit): UnitValues['fixed'] {
  const v = obj(value);
  const integer = unit === 'bars';
  const lim = integer ? LIMITS.bars : LIMITS.seconds;
  // There must be some sound in every cycle, so `every` is always longer than `silence`.
  const minSound = integer ? 1 : 0.5;
  const silence = num(v.silence, fallback.silence, lim.min, lim.max - minSound, integer);
  const every = num(v.every, fallback.every, silence + minSound, lim.max, integer);
  return { silence, every };
}

function sanitizeBeatLevels(value: unknown, legacyAccent: unknown): BeatLevel[] {
  const saved = Array.isArray(value) ? value : [];
  return DEFAULT_SETTINGS.beatLevels.map((fallback, i) => {
    if (BEAT_LEVEL_ORDER.includes(saved[i])) return saved[i] as BeatLevel;
    // Settings saved before per-beat levels existed had a single "accent the 1" switch.
    if (i === 0 && !Array.isArray(value) && legacyAccent === false) return 'normal';
    return fallback;
  });
}

/** Accepts anything (e.g. old or hand-edited saved data) and returns valid settings. */
export function sanitizeSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  const v = obj(raw);
  const s = obj(v.silence);
  const beatUnit = (LIMITS.beatUnits as readonly number[]).includes(v.beatUnit as number) ? (v.beatUnit as number) : d.beatUnit;
  return {
    bpm: Math.round(num(v.bpm, d.bpm, LIMITS.bpm.min, LIMITS.bpm.max) * 10) / 10,
    beatsPerBar: num(v.beatsPerBar, d.beatsPerBar, LIMITS.beatsPerBar.min, LIMITS.beatsPerBar.max, true),
    beatUnit,
    beatLevels: sanitizeBeatLevels(v.beatLevels, v.accent),
    sound: CLICK_SOUNDS.some((c) => c.value === v.sound) ? (v.sound as ClickSound) : d.sound,
    volume: num(v.volume, d.volume, 0, 1),
    silence: {
      mode: s.mode === 'fixed' || s.mode === 'random' || s.mode === 'off' ? s.mode : d.silence.mode,
      unit: s.unit === 'seconds' || s.unit === 'bars' ? s.unit : d.silence.unit,
      bars: sanitizeUnit(s.bars, d.silence.bars, 'bars'),
      seconds: sanitizeUnit(s.seconds, d.silence.seconds, 'seconds'),
      chance: num(s.chance, d.silence.chance, LIMITS.chance.min, LIMITS.chance.max, true),
      seed: typeof s.seed === 'string' ? s.seed.slice(0, 40) : d.silence.seed,
    },
  };
}

export function loadSettings(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): Settings {
  try {
    const text = storage?.getItem(STORAGE_KEY);
    return sanitizeSettings(text ? JSON.parse(text) : {});
  } catch {
    return sanitizeSettings({});
  }
}

export function saveSettings(settings: Settings, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing or full storage: settings just won't persist.
  }
}

/** Schedule for the chosen silence mode, or null when silences are off. */
export function toScheduleOptions(settings: Settings, seed: string): ScheduleOptions | null {
  const { mode, unit, chance } = settings.silence;
  const u = settings.silence[unit];
  if (mode === 'off') return null;
  if (mode === 'fixed') {
    return { mode, unit, ...u.fixed, grace: u.grace, bpm: settings.bpm, beatsPerBar: settings.beatsPerBar };
  }
  return {
    mode,
    unit,
    length: { min: u.length.min, max: u.lengthRanged ? u.length.max : u.length.min },
    gap: { min: u.gap.min, max: u.gapRanged ? u.gap.max : u.gap.min },
    chance: chance / 100,
    grace: u.grace,
    bpm: settings.bpm,
    beatsPerBar: settings.beatsPerBar,
    seed,
  };
}
