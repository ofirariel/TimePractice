import { beatIndexToPosition } from './grid';
import type { Silence } from './schedule-random';

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Human description of a silence in 1-based bar/beat terms, e.g. "Bars 9–10" or "Bar 3 beat 2 → bar 4 beat 1". */
export function describeSilence(s: Silence, beatsPerBar: number): string {
  const start = beatIndexToPosition(s.startBeat, beatsPerBar);
  const last = beatIndexToPosition(s.endBeat - 1, beatsPerBar);
  const wholeBars = start.beat === 0 && last.beat === beatsPerBar - 1;
  if (wholeBars) {
    return start.bar === last.bar ? `Bar ${start.bar + 1}` : `Bars ${start.bar + 1}–${last.bar + 1}`;
  }
  if (s.endBeat - s.startBeat === 1) return `Bar ${start.bar + 1} beat ${start.beat + 1}`;
  return `Bar ${start.bar + 1} beat ${start.beat + 1} → bar ${last.bar + 1} beat ${last.beat + 1}`;
}
