import { describe, expect, it } from 'vitest';
import { parseVideoId } from '../src/core/youtube-url';
import { barSeconds, normalizeOffset, nudgeOffset, offsetFromTaps } from '../src/core/tap-align';
import { nextBoundary, shiftSilences, silenceAt } from '../src/core/silence-lookup';
import { createRng } from '../src/core/rng';

describe('parseVideoId', () => {
  const id = 'dQw4w9WgXcQ';
  it.each([
    id,
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&t=42s&list=PL123`,
    `https://m.youtube.com/watch?feature=share&v=${id}`,
    `https://music.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}`,
    `https://youtu.be/${id}?si=abcdef&t=10`,
    `youtu.be/${id}`,
    `www.youtube.com/watch?v=${id}`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/embed/${id}?start=5`,
    `https://www.youtube.com/live/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`,
    `  https://www.youtube.com/watch?v=${id}  `,
  ])('reads %s', (input) => {
    expect(parseVideoId(input)).toBe(id);
  });

  it.each(['', 'hello', 'https://vimeo.com/12345', 'https://www.youtube.com/watch?v=short', 'https://www.youtube.com/@channel', 'https://evil.com/watch?v=dQw4w9WgXcQ'])(
    'rejects %s',
    (input) => {
      expect(parseVideoId(input)).toBeNull();
    },
  );
});

describe('tap alignment', () => {
  const bpm = 120;
  const bpb = 4;
  const bar = barSeconds(bpm, bpb);

  it('needs at least two taps', () => {
    expect(offsetFromTaps([], bpm, bpb)).toBeNull();
    expect(offsetFromTaps([1.3], bpm, bpb)).toBeNull();
  });

  it('recovers the downbeat from exact taps on non-consecutive bars', () => {
    const r = offsetFromTaps([0.3 + 5 * bar, 0.3 + 6 * bar, 0.3 + 9 * bar, 0.3 + 30 * bar], bpm, bpb)!;
    expect(r.offset).toBeCloseTo(0.3, 9);
    expect(r.spreadMs).toBeLessThan(0.01);
  });

  it('averages human jitter to within a few milliseconds', () => {
    const rng = createRng(5);
    const truth = 1.234;
    const taps = Array.from({ length: 8 }, (_, i) => truth + (10 + i) * bar + (rng() - 0.5) * 0.06);
    const r = offsetFromTaps(taps, bpm, bpb)!;
    expect(Math.abs(r.offset - normalizeOffset(truth, bar))).toBeLessThan(0.015);
    expect(r.spreadMs).toBeGreaterThan(5);
    expect(r.spreadMs).toBeLessThan(30);
  });

  it('handles taps straddling the bar line', () => {
    // Downbeat at exactly 0 (mod bar): taps 20 ms early and 20 ms late.
    const r = offsetFromTaps([3 * bar - 0.02, 4 * bar + 0.02, 5 * bar - 0.02, 6 * bar + 0.02], bpm, bpb)!;
    const distance = Math.min(r.offset, bar - r.offset);
    expect(distance).toBeLessThan(1e-6);
  });

  it('reports a big spread when taps are not on a consistent beat', () => {
    const r = offsetFromTaps([0, 0.5, 1.0, 1.5], bpm, bpb)!;
    expect(r.spreadMs).toBeGreaterThan(300);
  });

  it('normalises offsets into the first bar', () => {
    expect(normalizeOffset(4.3, 2)).toBeCloseTo(0.3, 9);
    expect(normalizeOffset(-0.5, 2)).toBeCloseTo(1.5, 9);
    expect(normalizeOffset(2, 2)).toBe(0);
  });

  it('nudges earlier and later, wrapping around the bar', () => {
    expect(nudgeOffset(0.3, 0.01, bpm, bpb)).toBeCloseTo(0.31, 9);
    expect(nudgeOffset(0.005, -0.01, bpm, bpb)).toBeCloseTo(bar - 0.005, 9);
    // Moving the "1" by a whole beat.
    expect(nudgeOffset(0.3, 0.5, bpm, bpb)).toBeCloseTo(0.8, 9);
    expect(nudgeOffset(0.3, -0.5, bpm, bpb)).toBeCloseTo(1.8, 9);
  });
});

describe('silence lookup', () => {
  const silences = [
    { startBeat: 8, endBeat: 12 },
    { startBeat: 20, endBeat: 21 },
    { startBeat: 40, endBeat: 48 },
  ];

  it('finds the silence covering a beat position', () => {
    expect(silenceAt(silences, 0)).toBeNull();
    expect(silenceAt(silences, 7.999)).toBeNull();
    expect(silenceAt(silences, 8)).toEqual(silences[0]);
    expect(silenceAt(silences, 11.99)).toEqual(silences[0]);
    expect(silenceAt(silences, 12)).toBeNull();
    expect(silenceAt(silences, 20.5)).toEqual(silences[1]);
    expect(silenceAt(silences, 47)).toEqual(silences[2]);
    expect(silenceAt(silences, 100)).toBeNull();
    expect(silenceAt([], 5)).toBeNull();
  });

  it('finds the next change', () => {
    expect(nextBoundary(silences, 0)).toBe(8);
    expect(nextBoundary(silences, 8)).toBe(12);
    expect(nextBoundary(silences, 12)).toBe(20);
    expect(nextBoundary(silences, 20.2)).toBe(21);
    expect(nextBoundary(silences, 47.9)).toBe(48);
    expect(nextBoundary(silences, 48)).toBeNull();
  });

  it('shifts silences', () => {
    expect(shiftSilences(silences.slice(0, 1), 16)).toEqual([{ startBeat: 24, endBeat: 28 }]);
  });
});
