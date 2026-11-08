/** Length of the fade into and out of a silence: short enough to sound instant, long enough to avoid pops. */
export const FADE_SECONDS = 0.005;

/**
 * The master gain every source plays through. Mutes are booked ahead of time on the
 * audio clock and finish exactly at the requested time, so a silence starting on a
 * beat swallows that beat's click entirely and a silence ending on a beat lets it through in full.
 */
export class MuteGate {
  /** Sources connect here. */
  readonly input: GainNode;
  private readonly volume: GainNode;

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode,
    volume: number,
  ) {
    this.input = ctx.createGain();
    this.volume = ctx.createGain();
    this.volume.gain.value = volume;
    this.input.connect(this.volume).connect(destination);
  }

  muteAt(time: number): void {
    const g = this.input.gain;
    g.setValueAtTime(1, time - FADE_SECONDS);
    g.linearRampToValueAtTime(0, time);
  }

  unmuteAt(time: number): void {
    const g = this.input.gain;
    g.setValueAtTime(0, time - FADE_SECONDS);
    g.linearRampToValueAtTime(1, time);
  }

  setVolume(value: number): void {
    this.volume.gain.setTargetAtTime(value, this.ctx.currentTime, 0.02);
  }

  /** Fades out quickly and detaches, silencing anything already booked for later. */
  close(): void {
    const now = this.ctx.currentTime;
    const g = this.volume.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + 0.03);
    setTimeout(() => this.volume.disconnect(), 100);
  }
}
