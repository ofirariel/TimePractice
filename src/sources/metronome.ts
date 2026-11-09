import { renderClickSamples, type AudibleLevel, type BeatLevel, type ClickSound } from './click-sounds';

const cache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();

function clickBuffer(ctx: BaseAudioContext, sound: ClickSound, level: AudibleLevel): AudioBuffer {
  let buffers = cache.get(ctx);
  if (!buffers) cache.set(ctx, (buffers = new Map()));
  const key = `${sound}:${level}`;
  let buffer = buffers.get(key);
  if (!buffer) {
    const samples = renderClickSamples(sound, level, ctx.sampleRate);
    buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buffer.copyToChannel(samples, 0);
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

  /** Books one click to start exactly at `time` on the audio clock. */
  click(time: number, level: BeatLevel): void {
    if (level === 'off') return;
    const src = this.ctx.createBufferSource();
    src.buffer = clickBuffer(this.ctx, this.sound, level);
    src.connect(this.destination);
    src.start(time);
  }
}

/** Plays one click straight away, e.g. to preview a sound. */
export function previewClick(ctx: AudioContext, sound: ClickSound, level: BeatLevel, volume: number): void {
  const gain = ctx.createGain();
  gain.gain.value = volume;
  gain.connect(ctx.destination);
  new Metronome(ctx, gain, sound).click(ctx.currentTime + 0.01, level);
}
