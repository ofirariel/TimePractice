import { createRng } from '../src/core/rng';

export const DRUM_RATE = 22050;

/** A drum-machine bar: kick on 1 (and 3 in 4/4), snare on the backbeat, quiet hats in between. */
export function drumTrack(bpm: number, offset: number, beatsPerBar: number, seconds: number): Float32Array {
  const out = new Float32Array(Math.floor(seconds * DRUM_RATE));
  const rng = createRng(1234);
  const beat = 60 / bpm;
  const add = (time: number, freq: number, amp: number, decay: number, noise: boolean) => {
    const start = Math.floor(time * DRUM_RATE);
    const length = Math.floor(decay * DRUM_RATE);
    for (let i = 0; i < length && start + i < out.length; i++) {
      const t = i / DRUM_RATE;
      const env = Math.exp(-t / (decay * 0.28));
      const tone = noise ? rng() * 2 - 1 : Math.sin(2 * Math.PI * freq * t);
      out[start + i] += amp * env * tone;
    }
  };
  for (let i = 0; ; i++) {
    const time = offset + i * beat;
    if (time >= seconds - 0.1) break;
    const place = ((i % beatsPerBar) + beatsPerBar) % beatsPerBar;
    const kick = place === 0 || (beatsPerBar === 4 && place === 2);
    const snare = beatsPerBar === 4 && (place === 1 || place === 3);
    if (kick) add(time, 70, 1, 0.1, false);
    else if (snare) add(time, 2200, 0.55, 0.07, true);
    else add(time, 160, 0.4, 0.06, false);
    add(time + beat / 2, 3500, 0.05, 0.015, true);
  }
  return out;
}
