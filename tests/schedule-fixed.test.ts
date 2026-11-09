import { describe, expect, it } from 'vitest';
import { FixedSchedule, type FixedScheduleOptions } from '../src/core/schedule-fixed';
import { generateSchedule, scheduleSeed, type ScheduleOptions } from '../src/core/schedule';
import { generateRandomSchedule, type Silence } from '../src/core/schedule-random';

const bars: ScheduleOptions = { mode: 'fixed', unit: 'bars', silence: 2, every: 4, grace: 0, bpm: 100, beatsPerBar: 4 };

function assertNoOverlap(silences: Silence[]) {
  silences.forEach((s, i) => {
    expect(s.endBeat).toBeGreaterThan(s.startBeat);
    if (i > 0) expect(s.startBeat).toBeGreaterThan(silences[i - 1].endBeat);
  });
}

describe('fixed schedule', () => {
  it('"2 of every 4 bars" plays bars 1–2 and silences bars 3–4, repeating', () => {
    expect(generateSchedule(bars, 64)).toEqual([
      { startBeat: 8, endBeat: 16 },
      { startBeat: 24, endBeat: 32 },
      { startBeat: 40, endBeat: 48 },
      { startBeat: 56, endBeat: 64 },
    ]);
  });

  it('works in other time signatures and ratios', () => {
    const s = generateSchedule({ ...bars, beatsPerBar: 3, silence: 1, every: 3 }, 30);
    expect(s).toEqual([
      { startBeat: 6, endBeat: 9 },
      { startBeat: 15, endBeat: 18 },
      { startBeat: 24, endBeat: 27 },
    ]);
  });

  it('starts the first cycle after the warm-up', () => {
    const [first] = generateSchedule({ ...bars, grace: 4 }, 1000);
    expect(first).toEqual({ startBeat: 16 + 8, endBeat: 16 + 16 });
  });

  it('always leaves at least one bar of sound, even if silence ≥ every', () => {
    const s = generateSchedule({ ...bars, silence: 4, every: 4 }, 200);
    assertNoOverlap(s);
    expect(s[0]).toEqual({ startBeat: 4, endBeat: 20 });
    expect(s[1].startBeat - s[0].endBeat).toBe(4);
  });

  it('in seconds, lands on whole beats and does not drift over a long session', () => {
    // 4 s of silence every 10 s at 97 BPM (beats are 0.6186 s, so nothing divides evenly).
    const bpm = 97;
    const opts: ScheduleOptions = { mode: 'fixed', unit: 'seconds', silence: 4, every: 10, grace: 0, bpm, beatsPerBar: 4 };
    const s = generateSchedule(opts, 10000);
    const beat = 60 / bpm;
    assertNoOverlap(s);
    s.forEach((x, k) => {
      expect(Number.isInteger(x.startBeat) && Number.isInteger(x.endBeat)).toBe(true);
      // Each boundary is within half a beat of its exact time in seconds.
      expect(Math.abs(x.startBeat * beat - (k * 10 + 6))).toBeLessThanOrEqual(beat / 2 + 1e-9);
      expect(Math.abs(x.endBeat * beat - (k + 1) * 10)).toBeLessThanOrEqual(beat / 2 + 1e-9);
    });
    expect(s.length).toBeGreaterThan(500);
  });

  it('respects a warm-up in seconds, rounding up to the next beat', () => {
    // 7 s at 100 BPM = 11.67 beats -> first cycle starts on beat 12.
    const [first] = generateSchedule({ mode: 'fixed', unit: 'seconds', silence: 3, every: 6, grace: 7, bpm: 100, beatsPerBar: 4 }, 1000);
    expect(first).toEqual({ startBeat: 12 + 5, endBeat: 12 + 10 });
  });

  it('copes with tiny or nonsense values without overlapping', () => {
    const odd: FixedScheduleOptions[] = [
      { unit: 'seconds', silence: 0.5, every: 1, grace: 0, bpm: 20, beatsPerBar: 4 },
      { unit: 'seconds', silence: 5, every: 2, grace: -3, bpm: 400, beatsPerBar: 7 },
      { unit: 'bars', silence: NaN, every: 0, grace: NaN, bpm: NaN, beatsPerBar: 0 },
    ];
    for (const o of odd) {
      const sched = new FixedSchedule(o);
      const s = Array.from({ length: 200 }, () => sched.next());
      assertNoOverlap(s);
      expect(s[0].startBeat).toBeGreaterThanOrEqual(0);
    }
  });

  it('the shared entry point still produces the random schedule unchanged', () => {
    const random = { unit: 'bars', length: { min: 1, max: 3 }, gap: { min: 2, max: 5 }, chance: 0.8, grace: 2, bpm: 120, beatsPerBar: 4, seed: 'x' } as const;
    expect(generateSchedule({ mode: 'random', ...random }, 4000)).toEqual(generateRandomSchedule(random, 4000));
    expect(scheduleSeed({ mode: 'random', ...random })).toBe('x');
    expect(scheduleSeed(bars)).toBeNull();
    expect(scheduleSeed(null)).toBeNull();
  });
});
