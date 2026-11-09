import { describe, expect, it } from 'vitest';
import type { Grid } from '../src/core/grid';
import { planFilePlayback, type FileEvent } from '../src/sources/file-plan';

const grid: Grid = { bpm: 120, beatsPerBar: 4, offset: 0 };
const fixed = { mode: 'fixed' as const, unit: 'bars' as const, silence: 2, every: 4, grace: 0, bpm: 120, beatsPerBar: 4 };

function between(events: FileEvent[], from: number, to: number) {
  return events.filter((e) => e.time >= from && e.time < to);
}

describe('file playback plan', () => {
  it('silences the last 2 of every 4 bars and clicks every beat', () => {
    const events = planFilePlayback({ grid, duration: 8, schedule: fixed, beatLevels: ['accent', 'normal', 'normal', 'normal'] });
    const mutes = events.filter((e) => e.kind === 'mute').map((e) => e.time);
    const unmutes = events.filter((e) => e.kind === 'unmute').map((e) => e.time);
    // Bars 3–4 are beats 8–16, i.e. 4s–8s. The file ends as the silence ends, so there is no unmute.
    expect(mutes).toEqual([4]);
    expect(unmutes).toEqual([]);
    const clicks = events.filter((e) => e.kind === 'click');
    expect(clicks).toHaveLength(16);
    expect(clicks[0]).toMatchObject({ time: 0, level: 'accent' });
    expect(clicks[1]).toMatchObject({ time: 0.5, level: 'normal' });
    expect(clicks[4]).toMatchObject({ time: 2, level: 'accent' });
    // The click on the downbeat of the silent bar is scheduled; the mute gate swallows it.
    expect(clicks.some((c) => c.time === 4)).toBe(true);
  });

  it('places a grid that does not start at zero', () => {
    const shifted: Grid = { bpm: 100, beatsPerBar: 4, offset: 0.3 };
    const events = planFilePlayback({
      grid: shifted,
      duration: 3,
      schedule: { ...fixed, bpm: 100, grace: 0, silence: 1, every: 2 },
      beatLevels: null,
    });
    // Beat 0 is at 0.3s. "1 of every 2 bars" in 4/4: silence the 2nd bar, beats 4–8.
    expect(events.filter((e) => e.kind === 'mute').map((e) => e.time)).toEqual([0.3 + 4 * 0.6]);
    expect(between(events, 0, 0.3).every((e) => e.kind !== 'click')).toBe(true);
  });

  it('skips silent click levels and an empty file', () => {
    const events = planFilePlayback({ grid, duration: 2, schedule: null, beatLevels: ['off', 'normal', 'off', 'soft'] });
    // Beats at 0, 0.5, 1 and 1.5; the "off" ones are left out.
    expect(events.map((e) => e.level)).toEqual(['normal', 'soft']);
    expect(planFilePlayback({ grid, duration: 0, schedule: fixed, beatLevels: ['accent'] })).toEqual([]);
  });

  it('keeps mutes and clicks in time order', () => {
    const events = planFilePlayback({ grid, duration: 16, schedule: fixed, beatLevels: ['normal', 'normal', 'normal', 'normal'] });
    for (let i = 1; i < events.length; i++) expect(events[i].time).toBeGreaterThanOrEqual(events[i - 1].time);
    // A second cycle unmutes at 8s and mutes again at 12s.
    expect(events.filter((e) => e.kind === 'unmute').map((e) => e.time)).toEqual([8]);
    expect(events.filter((e) => e.kind === 'mute').map((e) => e.time)).toEqual([4, 12]);
  });
});
