import type { Silence } from './schedule-random';

export type GateEvent = 'mute' | 'unmute' | null;

export interface SilenceSource {
  next(): Silence;
}

/**
 * Walks a silence stream beat by beat, telling the audio engine when to mute and unmute,
 * and remembering every silence that has started (for the post-session timeline).
 */
export class SilenceCursor {
  private upcoming: Silence | null;
  private active = false;
  readonly started: Silence[] = [];

  constructor(private readonly source: SilenceSource | null) {
    this.upcoming = source?.next() ?? null;
  }

  /** Call once per beat, in order, starting at beat 0. */
  at(beat: number): GateEvent {
    const s = this.upcoming;
    if (!s || !this.source) return null;
    if (this.active && beat >= s.endBeat) {
      this.active = false;
      this.upcoming = this.source.next();
      return 'unmute';
    }
    if (!this.active && beat >= s.startBeat) {
      this.active = true;
      this.started.push(s);
      return 'mute';
    }
    return null;
  }
}

/** Silences as actually heard in a session that ended at `stopBeat` (exclusive). */
export function clipSilences(silences: readonly Silence[], stopBeat: number): Silence[] {
  return silences
    .filter((s) => s.startBeat < stopBeat)
    .map((s) => ({ startBeat: s.startBeat, endBeat: Math.min(s.endBeat, stopBeat) }));
}
