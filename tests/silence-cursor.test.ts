import { describe, expect, it } from 'vitest';
import { clipSilences, SilenceCursor } from '../src/core/silence-cursor';
import { describeSilence, formatClock } from '../src/core/format';
import { RandomSchedule, generateRandomSchedule, type RandomScheduleOptions, type Silence } from '../src/core/schedule-random';

function listSource(list: Silence[]) {
  let i = 0;
  return { next: () => list[i++] ?? { startBeat: Infinity, endBeat: Infinity } };
}

describe('silence cursor', () => {
  it('mutes on the first silent beat and unmutes on the beat where sound returns', () => {
    const cursor = new SilenceCursor(listSource([{ startBeat: 4, endBeat: 8 }, { startBeat: 12, endBeat: 13 }]));
    const events = Array.from({ length: 16 }, (_, b) => cursor.at(b));
    expect(events.map((e, b) => (e ? `${b}:${e}` : null)).filter(Boolean)).toEqual(['4:mute', '8:unmute', '12:mute', '13:unmute']);
    expect(cursor.started).toEqual([{ startBeat: 4, endBeat: 8 }, { startBeat: 12, endBeat: 13 }]);
  });

  it('does nothing without a schedule', () => {
    const cursor = new SilenceCursor(null);
    expect(Array.from({ length: 50 }, (_, b) => cursor.at(b)).every((e) => e === null)).toBe(true);
    expect(cursor.started).toEqual([]);
  });

  it('produces exactly the generated schedule when driven by a random schedule', () => {
    const opts: RandomScheduleOptions = {
      unit: 'seconds', length: { min: 1, max: 5 }, gap: { min: 0.5, max: 4 }, chance: 0.7, grace: 3, bpm: 140, beatsPerBar: 5, seed: 99,
    };
    const cursor = new SilenceCursor(new RandomSchedule(opts));
    let muted = false;
    for (let b = 0; b < 3000; b++) {
      const e = cursor.at(b);
      if (e === 'mute') { expect(muted).toBe(false); muted = true; }
      if (e === 'unmute') { expect(muted).toBe(true); muted = false; }
    }
    expect(cursor.started).toEqual(generateRandomSchedule(opts, 3000));
  });

  it('clips silences to the moment the session stopped', () => {
    const s = [{ startBeat: 4, endBeat: 8 }, { startBeat: 12, endBeat: 20 }, { startBeat: 30, endBeat: 31 }];
    expect(clipSilences(s, 16)).toEqual([{ startBeat: 4, endBeat: 8 }, { startBeat: 12, endBeat: 16 }]);
    expect(clipSilences(s, 0)).toEqual([]);
  });
});

describe('format', () => {
  it('formats a clock', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65.9)).toBe('1:05');
    expect(formatClock(600)).toBe('10:00');
  });

  it('describes silences in musician terms', () => {
    expect(describeSilence({ startBeat: 32, endBeat: 40 }, 4)).toBe('Bars 9–10');
    expect(describeSilence({ startBeat: 32, endBeat: 36 }, 4)).toBe('Bar 9');
    expect(describeSilence({ startBeat: 9, endBeat: 10 }, 4)).toBe('Bar 3 beat 2');
    expect(describeSilence({ startBeat: 9, endBeat: 13 }, 4)).toBe('Bar 3 beat 2 → bar 4 beat 1');
  });
});
