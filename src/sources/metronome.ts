interface ClickSounds {
  accent: AudioBuffer;
  normal: AudioBuffer;
}

const cache = new WeakMap<BaseAudioContext, ClickSounds>();

/** A short woodblock-like blip: a sine burst with a fast attack and exponential decay. */
function renderClick(ctx: BaseAudioContext, frequency: number, amplitude: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * 0.06);
  const buffer = ctx.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);
  const attack = rate * 0.0005;
  const decay = rate * 0.009;
  for (let i = 0; i < length; i++) {
    const env = Math.min(1, i / attack) * Math.exp(-i / decay);
    data[i] = amplitude * env * Math.sin((2 * Math.PI * frequency * i) / rate);
  }
  return buffer;
}

function sounds(ctx: BaseAudioContext): ClickSounds {
  let s = cache.get(ctx);
  if (!s) {
    s = { accent: renderClick(ctx, 1760, 0.9), normal: renderClick(ctx, 1175, 0.6) };
    cache.set(ctx, s);
  }
  return s;
}

export class Metronome {
  private readonly sounds: ClickSounds;

  constructor(
    private readonly ctx: AudioContext,
    private readonly destination: AudioNode,
  ) {
    this.sounds = sounds(ctx);
  }

  /** Books one click to start exactly at `time` on the audio clock. */
  click(time: number, accent: boolean): void {
    const src = this.ctx.createBufferSource();
    src.buffer = accent ? this.sounds.accent : this.sounds.normal;
    src.connect(this.destination);
    src.start(time);
  }
}
