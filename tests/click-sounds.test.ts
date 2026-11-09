import { describe, expect, it } from 'vitest';
import { CLICK_SOUNDS, MAX_CLICK_SECONDS, nextBeatLevel, renderClickSamples, type AudibleLevel } from '../src/sources/click-sounds';

const RATE = 48000;
const peak = (a: Float32Array) => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

describe('click sounds', () => {
  for (const { value: sound } of CLICK_SOUNDS) {
    it(`${sound}: starts and ends silently, fits in one beat at 400 BPM`, () => {
      for (const level of ['accent', 'normal', 'soft'] as AudibleLevel[]) {
        const s = renderClickSamples(sound, level, RATE);
        expect(s.length).toBeGreaterThan(0);
        expect(s.length / RATE).toBeLessThanOrEqual(MAX_CLICK_SECONDS);
        expect(Math.abs(s[0])).toBeLessThan(0.01);
        expect(Math.abs(s[s.length - 1])).toBeLessThan(1e-3);
        expect(s.every(Number.isFinite)).toBe(true);
      }
    });

    it(`${sound}: accent > normal > soft, and every sound is equally loud`, () => {
      const accent = peak(renderClickSamples(sound, 'accent', RATE));
      const normal = peak(renderClickSamples(sound, 'normal', RATE));
      const soft = peak(renderClickSamples(sound, 'soft', RATE));
      expect(accent).toBeCloseTo(0.9, 5);
      expect(normal).toBeCloseTo(0.6, 5);
      expect(soft).toBeCloseTo(0.24, 5);
    });
  }

  it('the sounds are actually different', () => {
    const rendered = CLICK_SOUNDS.map((c) => Array.from(renderClickSamples(c.value, 'normal', RATE).slice(0, 2000)).join());
    expect(new Set(rendered).size).toBe(CLICK_SOUNDS.length);
  });

  it('tapping a beat cycles accent → normal → soft → silent → accent', () => {
    expect(nextBeatLevel('accent')).toBe('normal');
    expect(nextBeatLevel('normal')).toBe('soft');
    expect(nextBeatLevel('soft')).toBe('off');
    expect(nextBeatLevel('off')).toBe('accent');
  });
});
