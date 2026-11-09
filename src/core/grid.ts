/**
 * The musical grid: converts between beat/bar positions and seconds.
 * Beats and bars are 0-based internally; the UI adds 1 for display.
 */
export interface Grid {
  bpm: number;
  beatsPerBar: number;
  /** Time (in seconds, on whatever clock the caller uses) of the first downbeat. */
  offset: number;
}

export interface Position {
  /** 0-based bar index (negative before the first downbeat). */
  bar: number;
  /** 0-based beat within the bar, 0..beatsPerBar-1. */
  beat: number;
  /** Absolute 0-based beat index since the first downbeat. */
  beatIndex: number;
}

export function beatDuration(bpm: number): number {
  return 60 / bpm;
}

export function barDuration(grid: Pick<Grid, 'bpm' | 'beatsPerBar'>): number {
  return beatDuration(grid.bpm) * grid.beatsPerBar;
}

/** Time of an absolute beat index. Computed by multiplication, never by accumulation, so it never drifts. */
export function beatToTime(grid: Grid, beatIndex: number): number {
  return grid.offset + (beatIndex * 60) / grid.bpm;
}

export function barToTime(grid: Grid, bar: number, beat = 0): number {
  return beatToTime(grid, bar * grid.beatsPerBar + beat);
}

/** Fractional beat index at a given time. */
export function timeToBeats(grid: Grid, time: number): number {
  return ((time - grid.offset) * grid.bpm) / 60;
}

/** The beat that is currently sounding (the last one at or before `time`). */
export function timeToPosition(grid: Grid, time: number): Position {
  // The epsilon absorbs float error so that a time computed by beatToTime(n) maps back to beat n.
  const beatIndex = Math.floor(timeToBeats(grid, time) + 1e-9);
  return beatIndexToPosition(beatIndex, grid.beatsPerBar);
}

export function beatIndexToPosition(beatIndex: number, beatsPerBar: number): Position {
  const bar = Math.floor(beatIndex / beatsPerBar);
  const beat = beatIndex - bar * beatsPerBar;
  return { bar, beat, beatIndex };
}

/** Number of whole beats closest to a duration in seconds (at least `min`). */
export function secondsToBeats(seconds: number, bpm: number, min = 1): number {
  return Math.max(min, Math.round((seconds * bpm) / 60));
}
