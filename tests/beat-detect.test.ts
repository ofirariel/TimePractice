import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { detectBeat, detectBeatFromPcm, onsetsFromFrames, type OnsetTrack } from '../src/core/beat-detect';

const RATE = 22050;

/** A drum-machine bar: kick on 1 (and 3 in 4/4), snare on the backbeat, quiet hats in between. */
export function drumTrack(bpm: number, offset: number, beatsPerBar: number, seconds: number): Float32Array {
  const out = new Float32Array(Math.floor(seconds * RATE));
  const rng = createRng(1234);
  const beat = 60 / bpm;
  const add = (time: number, freq: number, amp: number, decay: number, noise: boolean) => {
    const start = Math.floor(time * RATE);
    const length = Math.floor(decay * RATE);
    for (let i = 0; i < length && start + i < out.length; i++) {
      const t = i / RATE;
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

function wrap(value: number, period: number): number {
  const r = value % period;
  return r < 0 ? r + period : r;
}

describe('beat detection from audio', () => {
  for (const [bpm, offset, beats] of [[100, 0.37, 4], [84, 0.1, 4], [140, 0.8, 4], [96, 0.5, 3]] as const) {
    it(`finds ${bpm} BPM in ${beats}/4 and the downbeat`, () => {
      const found = detectBeatFromPcm(drumTrack(bpm, offset, beats, 24), RATE, beats);
      expect(Math.abs(found.bpm - bpm)).toBeLessThanOrEqual(0.6);
      const bar = (60 / bpm) * beats;
      const error = Math.min(wrap(found.offset - offset, bar), wrap(offset - found.offset, bar));
      expect(error).toBeLessThan(0.03);
      expect(found.confidence).toBeGreaterThan(0.1);
    });
  }

  it('stays on the quarter note when eighth-note hats are present', () => {
    const found = detectBeatFromPcm(drumTrack(90, 0.2, 4, 30), RATE, 4);
    expect(found.bpm).toBeGreaterThan(80);
    expect(found.bpm).toBeLessThan(100);
  });

  it('reports no confidence on silence', () => {
    const found = detectBeatFromPcm(new Float32Array(RATE * 8), RATE, 4);
    expect(found.confidence).toBe(0);
  });
});

describe('beat detection from analyser frames', () => {
  it('reads tempo and downbeat from magnitude frames', () => {
    const binHz = 22050 / 1024;
    const hop = 0.023;
    const bpm = 120;
    const beat = 60 / bpm;
    const downbeat = 0.21;
    const frames: number[][] = [];
    for (let i = 0; i < 800; i++) {
      const frame = new Array(512).fill(0);
      const time = i * hop;
      const index = Math.round((time - downbeat) / beat);
      const dist = Math.abs(time - (downbeat + index * beat));
      if (index >= 0 && dist < hop * 0.49) {
        const place = index % 4;
        if (place === 0 || place === 2) frame[Math.round(80 / binHz)] = place === 0 ? 14 : 8;
        if (place === 1 || place === 3) frame[Math.round(2500 / binHz)] = 9;
        frame[Math.round(1000 / binHz)] = 2;
      }
      frames.push(frame);
    }
    const track: OnsetTrack = onsetsFromFrames(frames, hop, binHz);
    const found = detectBeat(track, 4);
    expect(Math.abs(found.bpm - 120)).toBeLessThanOrEqual(1);
    const bar = 2;
    const error = Math.min(wrap(found.offset - downbeat, bar), wrap(downbeat - found.offset, bar));
    expect(error).toBeLessThan(0.05);
  });
});
