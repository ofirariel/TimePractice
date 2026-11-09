import { renderClickSamples, type AudibleLevel, type BeatLevel, type ClickSound } from './click-sounds';

const cache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();

function writeSamples(buffer: AudioBuffer, samples: Float32Array<ArrayBuffer>): void {
  // copyToChannel is the reliable write. Some browsers omit it; a few ignore edits to the
  // array from getChannelData, so try that only when copyToChannel is missing or throws.
  try {
    if (typeof buffer.copyToChannel === 'function') {
      buffer.copyToChannel(samples, 0);
      return;
    }
  } catch {
    // Fall through.
  }
  buffer.getChannelData(0).set(samples);
}

function clickBuffer(ctx: BaseAudioContext, sound: ClickSound, level: AudibleLevel): AudioBuffer {
  let buffers = cache.get(ctx);
  if (!buffers) cache.set(ctx, (buffers = new Map()));
  const key = `${sound}:${level}`;
  let buffer = buffers.get(key);
  if (!buffer) {
    const samples = renderClickSamples(sound, level, ctx.sampleRate);
    buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    writeSamples(buffer, samples);
    buffers.set(key, buffer);
  }
  return buffer;
}

export class Metronome {
  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly destination: AudioNode,
    public sound: ClickSound,
  ) {}

  /**
   * Books one click to start exactly at `time` on the audio clock.
   * A throw here used to escape the scheduler, so every later beat was dropped and the click went mute.
   */
  click(time: number, level: BeatLevel): void {
    if (level === 'off' || !Number.isFinite(time)) return;
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = clickBuffer(this.ctx, this.sound, level);
      src.connect(this.destination);
      src.start(Math.max(time, this.ctx.currentTime));
    } catch {
      // One rejected click must not cancel the beats that follow it.
    }
  }
}

/** Plays one click straight away, e.g. to preview a sound. */
export function previewClick(ctx: AudioContext, sound: ClickSound, level: BeatLevel, volume: number): void {
  const gain = ctx.createGain();
  gain.gain.value = volume;
  gain.connect(ctx.destination);
  new Metronome(ctx, gain, sound).click(ctx.currentTime + 0.01, level);
}
