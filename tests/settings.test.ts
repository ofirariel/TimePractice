import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, sanitizeSettings, saveSettings, toScheduleOptions } from '../src/state/settings';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe('settings', () => {
  it('returns defaults when nothing is saved or data is broken', () => {
    expect(loadSettings(memoryStorage())).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings({ getItem: () => '{not json' })).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips through storage', () => {
    const storage = memoryStorage();
    const s = sanitizeSettings({ ...DEFAULT_SETTINGS, bpm: 133.5, beatsPerBar: 7, beatUnit: 8 });
    saveSettings(s, storage);
    expect(loadSettings(storage)).toEqual(s);
  });

  it('clamps and repairs invalid values', () => {
    const s = sanitizeSettings({
      bpm: 9999,
      beatsPerBar: 3.6,
      beatUnit: 5,
      volume: -1,
      silence: { unit: 'parsecs', bars: { length: { min: 4, max: 2 }, grace: 2.4 }, chance: 0 },
    });
    expect(s.bpm).toBe(400);
    expect(s.beatsPerBar).toBe(4);
    expect(s.beatUnit).toBe(4);
    expect(s.volume).toBe(0);
    expect(s.silence.unit).toBe('bars');
    expect(s.silence.bars.length).toEqual({ min: 2, max: 4 });
    expect(s.silence.bars.grace).toBe(2);
    expect(s.silence.chance).toBe(1);
  });

  it('defaults to an accent on 1 and normal beats elsewhere, with the classic sound', () => {
    const s = sanitizeSettings({});
    expect(s.sound).toBe('classic');
    expect(s.beatLevels).toHaveLength(15);
    expect(s.beatLevels[0]).toBe('accent');
    expect(s.beatLevels.slice(1).every((l) => l === 'normal')).toBe(true);
  });

  it('keeps a saved beat pattern and click sound, repairing bad entries', () => {
    const s = sanitizeSettings({ sound: 'cowbell', beatLevels: ['accent', 'soft', 'bogus', 'off'] });
    expect(s.sound).toBe('cowbell');
    expect(s.beatLevels.slice(0, 5)).toEqual(['accent', 'soft', 'normal', 'off', 'normal']);
    expect(s.beatLevels).toHaveLength(15);
    expect(sanitizeSettings({ sound: 'kazoo' }).sound).toBe('classic');
  });

  it('carries over the old "accent the 1" switch', () => {
    expect(sanitizeSettings({ accent: false }).beatLevels[0]).toBe('normal');
    expect(sanitizeSettings({ accent: true }).beatLevels[0]).toBe('accent');
  });

  it('builds schedule options for the chosen unit, honouring fixed vs ranged', () => {
    const s = sanitizeSettings({
      ...DEFAULT_SETTINGS,
      silence: {
        ...DEFAULT_SETTINGS.silence,
        mode: 'random',
        unit: 'seconds',
        seconds: { length: { min: 3, max: 9 }, lengthRanged: false, gap: { min: 5, max: 10 }, gapRanged: true, grace: 6 },
        chance: 50,
      },
    });
    const o = toScheduleOptions(s, 'abc');
    expect(o).toMatchObject({
      mode: 'random',
      unit: 'seconds',
      length: { min: 3, max: 3 },
      gap: { min: 5, max: 10 },
      grace: 6,
      chance: 0.5,
      seed: 'abc',
    });
  });

  it('defaults to fixed silences: 2 of every 4 bars', () => {
    const s = sanitizeSettings({});
    expect(s.silence.mode).toBe('fixed');
    expect(s.silence.bars.fixed).toEqual({ silence: 2, every: 4 });
    expect(toScheduleOptions(s, 'x')).toEqual({
      mode: 'fixed', unit: 'bars', silence: 2, every: 4, grace: 4, bpm: 100, beatsPerBar: 4,
    });
  });

  it('keeps a saved mode and fixed values, and always leaves some sound in each cycle', () => {
    const s = sanitizeSettings({
      silence: { mode: 'random', bars: { fixed: { silence: 3, every: 2 } }, seconds: { fixed: { silence: 120, every: 1 } } },
    });
    expect(s.silence.mode).toBe('random');
    expect(s.silence.bars.fixed).toEqual({ silence: 3, every: 4 });
    expect(s.silence.seconds.fixed).toEqual({ silence: 119.5, every: 120 });
    expect(sanitizeSettings({ silence: { mode: 'sometimes' } }).silence.mode).toBe('fixed');
  });

  it('gives no schedule when silences are off', () => {
    const s = sanitizeSettings({ silence: { mode: 'off' } });
    expect(toScheduleOptions(s, 'x')).toBeNull();
  });
});
