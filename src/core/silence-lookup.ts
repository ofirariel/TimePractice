import type { Silence } from './schedule-random';

/** Moves every silence by `beats` (e.g. to start at the bar where practice began). */
export function shiftSilences(silences: readonly Silence[], beats: number): Silence[] {
  return silences.map((s) => ({ startBeat: s.startBeat + beats, endBeat: s.endBeat + beats }));
}

/** Index of the last silence starting at or before `beat`, or -1. `silences` must be sorted and non-overlapping. */
function lastStartingBy(silences: readonly Silence[], beat: number): number {
  let lo = 0;
  let hi = silences.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (silences[mid].startBeat <= beat) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** The silence covering a (possibly fractional) beat position, or null. */
export function silenceAt(silences: readonly Silence[], beat: number): Silence | null {
  const i = lastStartingBy(silences, beat);
  return i >= 0 && beat < silences[i].endBeat ? silences[i] : null;
}

/** The next beat after `beat` where sound stops or starts, or null if there are no more. */
export function nextBoundary(silences: readonly Silence[], beat: number): number | null {
  const i = lastStartingBy(silences, beat);
  if (i >= 0 && beat < silences[i].endBeat) return silences[i].endBeat;
  return i + 1 < silences.length ? silences[i + 1].startBeat : null;
}
