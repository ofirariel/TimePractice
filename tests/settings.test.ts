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

  it('builds schedule options for the chosen unit, honouring fixed vs ranged', () => {
    const s = sanitizeSettings({
      ...DEFAULT_SETTINGS,
      silence: {
        ...DEFAULT_SETTINGS.silence,
        unit: 'seconds',
        seconds: { length: { min: 3, max: 9 }, lengthRanged: false, gap: { min: 5, max: 10 }, gapRanged: true, grace: 6 },
        chance: 50,
      },
    });
    const o = toScheduleOptions(s, 'abc');
    expect(o).toMatchObject({
      unit: 'seconds',
      length: { min: 3, max: 3 },
      gap: { min: 5, max: 10 },
      grace: 6,
      chance: 0.5,
      seed: 'abc',
    });
  });
});
