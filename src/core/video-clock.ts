/** A playback-time jump bigger than this means the user seeked. */
const JUMP_SECONDS = 0.25;
/** No new playback time for this long while "playing" means an ad, buffering or a frozen player. */
export const STALL_SECONDS = 1.2;
/** Only recent readings count, so slow clock drift can't build up. */
const WINDOW_SECONDS = 4;

interface Sample {
  at: number;
  base: number;
}

/**
 * Turns the embedded player's coarse, slightly delayed playback-time reports into a
 * smooth clock. Each time the reported time changes, `at - videoTime` is an upper bound
 * on the true "clock time when the video was at 0" (the report can only be late, never
 * early), so the smallest recent value is the best estimate.
 *
 * All times are in seconds; `at` is any steady wall clock (e.g. performance.now() / 1000).
 */
export class VideoClock {
  private samples: Sample[] = [];
  private lastReported: number | null = null;
  private lastChangeAt = 0;
  private running = false;
  /** Increases whenever the clock restarts (resume, seek), so followers know to resync. */
  epoch = 0;

  /** Feed every poll of the player. `playing` must be false when paused, buffering or not at normal speed. */
  observe(at: number, videoTime: number, playing: boolean): void {
    if (!playing) {
      this.running = false;
      this.samples = [];
      this.lastReported = videoTime;
      return;
    }
    if (this.lastReported !== null && videoTime === this.lastReported) return;
    const first = this.lastReported === null;
    this.lastReported = videoTime;
    this.lastChangeAt = at;
    // The very first reading after loading may be stale from long ago; just wait for the next change.
    if (first) return;
    const base = at - videoTime;
    if (!this.running || (this.samples.length > 0 && Math.abs(base - this.base()) > JUMP_SECONDS)) {
      this.samples = [];
      this.running = true;
      this.epoch++;
    }
    this.samples.push({ at, base });
    while (this.samples.length > 1 && this.samples[0].at < at - WINDOW_SECONDS) this.samples.shift();
  }

  private base(): number {
    let min = Infinity;
    for (const s of this.samples) if (s.base < min) min = s.base;
    return min;
  }

  /** True while playing but the reported time has stopped moving (ad, buffering). */
  stalled(at: number): boolean {
    return this.running && at - this.lastChangeAt > STALL_SECONDS;
  }

  /** Estimated playback time now, or null if the video isn't (yet) playing smoothly. */
  now(at: number): number | null {
    if (!this.running || this.stalled(at)) return null;
    return at - this.base();
  }
}
