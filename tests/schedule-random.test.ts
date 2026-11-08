import { describe, expect, it } from 'vitest';
import {
  generateRandomSchedule,
  RandomSchedule,
  type RandomScheduleOptions,
  type Silence,
} from '../src/core/schedule-random';

const base: RandomScheduleOptions = {
  unit: 'bars',
  length: { min: 2, max: 4 },
  gap: { min: 4, max: 8 },
  chance: 1,
  grace: 4,
  bpm: 100,
  beatsPerBar: 4,
  seed: 'test',
};

const HORIZON = 4 * 2000;

function assertNoOverlap(silences: Silence[]) {
  for (let i = 0; i < silences.length; i++) {
    expect(silences[i].endBeat).toBeGreaterThan(silences[i].startBeat);
    if (i > 0) expect(silences[i].startBeat).toBeGreaterThan(silences[i - 1].endBeat);
  }
}

describe('random schedule', () => {
  it('gives the same schedule for the same seed', () => {
    const a = generateRandomSchedule(base, HORIZON);
    const b = generateRandomSchedule({ ...base }, HORIZON);
    expect(a.length).toBeGreaterThan(50);
    expect(a).toEqual(b);
  });

  it('gives a different schedule for a different seed', () => {
    const a = generateRandomSchedule(base, HORIZON);
    const b = generateRandomSchedule({ ...base, seed: 'other' }, HORIZON);
    expect(a).not.toEqual(b);
  });

  it('streams the same silences as the batch generator', () => {
    const batch = generateRandomSchedule(base, HORIZON);
    const stream = new RandomSchedule(base);
    for (const s of batch) expect(stream.next()).toEqual(s);
  });

  it('never overlaps and always leaves a gap', () => {
    for (const seed of ['a', 'b', 'c', 1, 2, 3]) {
      assertNoOverlap(generateRandomSchedule({ ...base, seed }, HORIZON));
      assertNoOverlap(generateRandomSchedule({ ...base, seed, unit: 'seconds', length: { min: 0.1, max: 9 }, gap: { min: 0, max: 3 } }, HORIZON));
    }
  });

  it('keeps bar-mode lengths and gaps within range, on bar lines', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const s = generateRandomSchedule({ ...base, seed }, HORIZON);
      const lengths = new Set<number>();
      const gaps = new Set<number>();
      s.forEach((x, i) => {
        expect(x.startBeat % 4).toBe(0);
        expect(x.endBeat % 4).toBe(0);
        const bars = (x.endBeat - x.startBeat) / 4;
        lengths.add(bars);
        expect(bars).toBeGreaterThanOrEqual(2);
        expect(bars).toBeLessThanOrEqual(4);
        if (i > 0) {
          const gapBars = (x.startBeat - s[i - 1].endBeat) / 4;
          gaps.add(gapBars);
          expect(gapBars).toBeGreaterThanOrEqual(4);
          expect(gapBars).toBeLessThanOrEqual(8);
        }
      });
      // Every allowed value actually shows up.
      expect([...lengths].sort()).toEqual([2, 3, 4]);
      expect([...gaps].sort()).toEqual([4, 5, 6, 7, 8]);
    }
  });

  it('supports a fixed length and gap', () => {
    const s = generateRandomSchedule({ ...base, length: { min: 2, max: 2 }, gap: { min: 6, max: 6 }, grace: 0 }, 200);
    expect(s.slice(0, 3)).toEqual([
      { startBeat: 0, endBeat: 8 },
      { startBeat: 32, endBeat: 40 },
      { startBeat: 64, endBeat: 72 },
    ]);
  });

  it('respects the grace period in bars', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const [first] = generateRandomSchedule({ ...base, grace: 8, seed }, HORIZON);
      expect(first.startBeat).toBeGreaterThanOrEqual(8 * 4);
    }
    const [first] = generateRandomSchedule({ ...base, grace: 8 }, HORIZON);
    expect(first.startBeat).toBe(32);
  });

  it('respects the grace period in seconds, rounding up to the next beat', () => {
    // 7 s at 100 BPM = 11.67 beats -> first possible beat is 12 (7.2 s).
    const [first] = generateRandomSchedule({ ...base, unit: 'seconds', grace: 7, length: { min: 2, max: 2 }, gap: { min: 2, max: 2 } }, HORIZON);
    expect(first.startBeat).toBe(12);
    expect((first.startBeat * 60) / 100).toBeGreaterThanOrEqual(7);
  });

  it('converts second-mode ranges to whole beats within range', () => {
    const bpm = 90;
    const beat = 60 / bpm;
    for (const seed of [1, 2, 3]) {
      const s = generateRandomSchedule({ ...base, unit: 'seconds', bpm, seed, length: { min: 3, max: 6 }, gap: { min: 5, max: 10 }, grace: 0 }, HORIZON);
      s.forEach((x, i) => {
        expect(Number.isInteger(x.startBeat)).toBe(true);
        expect(Number.isInteger(x.endBeat)).toBe(true);
        const seconds = (x.endBeat - x.startBeat) * beat;
        // Rounding to the nearest beat can move a value by at most half a beat.
        expect(seconds).toBeGreaterThanOrEqual(3 - beat / 2);
        expect(seconds).toBeLessThanOrEqual(6 + beat / 2);
        if (i > 0) {
          const gap = (x.startBeat - s[i - 1].endBeat) * beat;
          expect(gap).toBeGreaterThanOrEqual(5 - beat / 2);
          expect(gap).toBeLessThanOrEqual(10 + beat / 2);
        }
      });
    }
  });

  it('only starts silences on bar steps when chance < 1, and spreads them out', () => {
    const always = generateRandomSchedule({ ...base, length: { min: 1, max: 1 }, gap: { min: 1, max: 1 }, grace: 0 }, HORIZON);
    const rare = generateRandomSchedule({ ...base, length: { min: 1, max: 1 }, gap: { min: 1, max: 1 }, grace: 0, chance: 0.25 }, HORIZON);
    rare.forEach((x) => expect(x.startBeat % 4).toBe(0));
    assertNoOverlap(rare);
    expect(rare.length).toBeLessThan(always.length / 2);
    expect(rare.length).toBeGreaterThan(always.length / 10);
  });

  it('copes with nonsense input', () => {
    const s = generateRandomSchedule(
      { ...base, length: { min: 5, max: 1 }, gap: { min: -3, max: NaN }, chance: 0, grace: -2, beatsPerBar: 0 },
      HORIZON,
    );
    expect(s.length).toBeGreaterThan(0);
    assertNoOverlap(s);
    s.forEach((x) => expect(x.startBeat).toBeGreaterThanOrEqual(0));
  });
});
