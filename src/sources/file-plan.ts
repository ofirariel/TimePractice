import { beatToTime, timeToBeats, type Grid } from '../core/grid';
import { generateSchedule, type ScheduleOptions } from '../core/schedule';
import type { BeatLevel } from './click-sounds';

export interface FileEvent {
  /** Seconds from the start of the file. */
  time: number;
  kind: 'mute' | 'unmute' | 'click';
  level?: BeatLevel;
}

/**
 * Every mute, unmute and click for one play-through, on the file's own timeline.
 * The audio engine books these on the audio clock, so they land on the beat exactly.
 */
export function planFilePlayback(args: {
  grid: Grid;
  duration: number;
  schedule: ScheduleOptions | null;
  /** null = no click. */
  beatLevels: BeatLevel[] | null;
}): FileEvent[] {
  const { grid, duration, schedule, beatLevels } = args;
  const events: FileEvent[] = [];
  if (duration <= 0) return events;

  if (schedule) {
    const until = Math.floor(timeToBeats(grid, duration)) + 2;
    for (const silence of generateSchedule(schedule, Math.max(0, until))) {
      const start = beatToTime(grid, silence.startBeat);
      const end = beatToTime(grid, silence.endBeat);
      if (end <= 0 || start >= duration) continue;
      events.push({ time: Math.max(0, start), kind: 'mute' });
      if (end < duration) events.push({ time: end, kind: 'unmute' });
    }
  }

  if (beatLevels) {
    const beats = grid.beatsPerBar;
    const first = Math.max(0, Math.ceil(timeToBeats(grid, 0) - 1e-6));
    const last = Math.floor(timeToBeats(grid, duration) - 1e-6);
    for (let n = first; n <= last; n++) {
      const time = beatToTime(grid, n);
      if (time < 0 || time >= duration) continue;
      const level = beatLevels[((n % beats) + beats) % beats] ?? 'normal';
      if (level === 'off') continue;
      events.push({ time, kind: 'click', level });
    }
  }

  events.sort((a, b) => a.time - b.time || (a.kind === 'click' ? 1 : 0));
  return events;
}
