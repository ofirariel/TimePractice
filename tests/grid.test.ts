import { describe, expect, it } from 'vitest';
import {
  barDuration,
  barToTime,
  beatDuration,
  beatToTime,
  secondsToBeats,
  timeToBeats,
  timeToPosition,
  type Grid,
} from '../src/core/grid';

describe('grid', () => {
  const grid: Grid = { bpm: 120, beatsPerBar: 4, offset: 10 };

  it('computes beat and bar durations', () => {
    expect(beatDuration(120)).toBe(0.5);
    expect(beatDuration(60)).toBe(1);
    expect(barDuration({ bpm: 120, beatsPerBar: 4 })).toBe(2);
    expect(barDuration({ bpm: 90, beatsPerBar: 3 })).toBe(2);
  });

  it('converts bars and beats to seconds exactly', () => {
    expect(beatToTime(grid, 0)).toBe(10);
    expect(beatToTime(grid, 1)).toBe(10.5);
    expect(barToTime(grid, 16)).toBe(42);
    // "bar 17, beat 1" in musician terms is bar index 16, beat index 0.
    expect(barToTime(grid, 16, 0)).toBe(42);
    expect(barToTime(grid, 16, 2)).toBe(43);
  });

  it('round-trips beat -> time -> position for awkward tempos', () => {
    for (const bpm of [37, 61.5, 97, 119.8, 133, 177, 240]) {
      for (const beatsPerBar of [3, 4, 5, 7]) {
        const g: Grid = { bpm, beatsPerBar, offset: 3.217 };
        for (let n = 0; n < 5000; n += 7) {
          const pos = timeToPosition(g, beatToTime(g, n));
          expect(pos.beatIndex).toBe(n);
          expect(pos.bar * beatsPerBar + pos.beat).toBe(n);
          expect(pos.beat).toBeGreaterThanOrEqual(0);
          expect(pos.beat).toBeLessThan(beatsPerBar);
        }
      }
    }
  });

  it('does not drift over long sessions', () => {
    const g: Grid = { bpm: 119.8, beatsPerBar: 4, offset: 0 };
    // One hour at 119.8 BPM; computed by multiplication, error stays at float precision.
    const beats = 119.8 * 60;
    expect(beatToTime(g, beats)).toBeCloseTo(3600, 9);
  });

  it('reports the beat currently sounding between clicks', () => {
    expect(timeToPosition(grid, 10.49)).toEqual({ bar: 0, beat: 0, beatIndex: 0 });
    expect(timeToPosition(grid, 11.6)).toEqual({ bar: 0, beat: 3, beatIndex: 3 });
    expect(timeToPosition(grid, 12)).toEqual({ bar: 1, beat: 0, beatIndex: 4 });
    expect(timeToPosition(grid, 9.9).bar).toBe(-1);
  });

  it('converts time to fractional beats', () => {
    expect(timeToBeats(grid, 11.25)).toBe(2.5);
  });

  it('rounds seconds to whole beats with a minimum', () => {
    expect(secondsToBeats(3, 120)).toBe(6);
    expect(secondsToBeats(1.2, 100)).toBe(2);
    expect(secondsToBeats(0.1, 60)).toBe(1);
    expect(secondsToBeats(0.1, 60, 0)).toBe(0);
  });
});
