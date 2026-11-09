import { describe, expect, it } from 'vitest';
import { outputDelay } from '../src/sources/audio-context';

describe('outputDelay', () => {
  it('adds the output and base latency', () => {
    const ctx = { outputLatency: 0.02, baseLatency: 0.01 } as AudioContext;
    expect(outputDelay(ctx)).toBeCloseTo(0.03);
  });

  it('ignores a latency the browser reports as NaN or negative', () => {
    const ctx = { outputLatency: Number.NaN, baseLatency: -1 } as AudioContext;
    expect(outputDelay(ctx)).toBe(0);
  });
});
