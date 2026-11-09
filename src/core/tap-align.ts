export interface TapResult {
  /** Time of a downbeat, normalised to [0, one bar). */
  offset: number;
  /** How far the taps stray from that grid, in milliseconds (circular standard deviation). */
  spreadMs: number;
}

export function barSeconds(bpm: number, beatsPerBar: number): number {
  return (60 * beatsPerBar) / bpm;
}

/** Wraps a downbeat time into [0, period) so the first bar starts near the beginning of the track. */
export function normalizeOffset(offset: number, period: number): number {
  const r = offset % period;
  const n = r < 0 ? r + period : r;
  // Values a hair below a full period are float noise for "0".
  return period - n < 1e-9 ? 0 : n;
}

/**
 * Finds where the bars start from taps on the "1". Taps only need to land on
 * downbeats, not on consecutive bars, so a missed bar doesn't matter. Uses a
 * circular mean of each tap's position within the bar, which also handles taps
 * that straddle the bar line (a bit early on one bar, a bit late on the next).
 */
export function offsetFromTaps(taps: readonly number[], bpm: number, beatsPerBar: number): TapResult | null {
  if (taps.length < 2) return null;
  const period = barSeconds(bpm, beatsPerBar);
  let x = 0;
  let y = 0;
  for (const t of taps) {
    const a = (2 * Math.PI * t) / period;
    x += Math.cos(a);
    y += Math.sin(a);
  }
  x /= taps.length;
  y /= taps.length;
  const r = Math.min(1, Math.hypot(x, y));
  const offset = normalizeOffset((Math.atan2(y, x) / (2 * Math.PI)) * period, period);
  const spread = r > 0 ? Math.sqrt(-2 * Math.log(r)) : Math.PI;
  return { offset, spreadMs: ((spread / (2 * Math.PI)) * period) * 1000 };
}

/** Moves the grid by `seconds` (positive = later), keeping the offset within the first bar. */
export function nudgeOffset(offset: number, seconds: number, bpm: number, beatsPerBar: number): number {
  return normalizeOffset(offset + seconds, barSeconds(bpm, beatsPerBar));
}
