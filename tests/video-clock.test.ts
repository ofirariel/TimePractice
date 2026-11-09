import { describe, expect, it } from 'vitest';
import { VideoClock } from '../src/core/video-clock';
import { createRng } from '../src/core/rng';

/**
 * Simulates the embedded player: the real video time advances smoothly, but the page only
 * learns it through reports every `reportEvery` seconds that arrive up to `maxDelay` late.
 */
function simulate(opts: { start: number; seconds: number; reportEvery: number; maxDelay: number; poll: number; seed?: number }) {
  const rng = createRng(opts.seed ?? 1);
  const clock = new VideoClock();
  const truthBase = 100; // wall time when the video was at 0
  let reported = opts.start;
  let nextReport = truthBase + opts.start;
  let pendingAt = Infinity;
  let pendingValue = 0;
  let worst = 0;
  const startAt = truthBase + opts.start;
  clock.observe(startAt - 1, opts.start, false);
  for (let at = startAt; at < startAt + opts.seconds; at += opts.poll) {
    if (at >= nextReport && pendingAt === Infinity) {
      pendingValue = nextReport - truthBase;
      pendingAt = nextReport + rng() * opts.maxDelay;
      nextReport += opts.reportEvery;
    }
    if (at >= pendingAt) {
      reported = pendingValue;
      pendingAt = Infinity;
    }
    clock.observe(at, reported, true);
    const est = clock.now(at);
    if (est !== null && at > startAt + 2) worst = Math.max(worst, Math.abs(est - (at - truthBase)));
  }
  return { clock, worst };
}

describe('video clock', () => {
  it('is unknown until the video is playing and reporting', () => {
    const c = new VideoClock();
    expect(c.now(0)).toBeNull();
    c.observe(0, 5, false);
    expect(c.now(0.1)).toBeNull();
    c.observe(1, 5, true);
    expect(c.now(1)).toBeNull();
    c.observe(1.25, 5.25, true);
    expect(c.now(1.25)).toBeCloseTo(5.25, 9);
    expect(c.now(1.3)).toBeCloseTo(5.3, 9);
  });

  it('tracks to within a few ms despite coarse, late reports', () => {
    const { worst } = simulate({ start: 0, seconds: 30, reportEvery: 0.25, maxDelay: 0.04, poll: 0.005 });
    expect(worst).toBeLessThan(0.01);
  });

  it('copes with frequent reports and slow polling', () => {
    const { worst } = simulate({ start: 12, seconds: 30, reportEvery: 0.05, maxDelay: 0.01, poll: 0.016, seed: 3 });
    expect(worst).toBeLessThan(0.02);
  });

  it('stops when paused and restarts with a new epoch', () => {
    const c = new VideoClock();
    c.observe(0, 0, false);
    c.observe(1, 0.1, true);
    c.observe(1.1, 0.2, true);
    const epoch = c.epoch;
    expect(c.now(1.1)).not.toBeNull();
    c.observe(2, 1.0, false);
    expect(c.now(2)).toBeNull();
    c.observe(5, 1.0, true); // resumed, but no new report yet
    expect(c.now(5)).toBeNull();
    c.observe(5.1, 1.1, true);
    expect(c.now(5.1)).toBeCloseTo(1.1, 9);
    expect(c.epoch).toBeGreaterThan(epoch);
  });

  it('resyncs immediately after a seek', () => {
    const c = new VideoClock();
    c.observe(0, 0, false);
    for (let i = 1; i <= 10; i++) c.observe(i * 0.1, i * 0.1, true);
    const epoch = c.epoch;
    c.observe(1.1, 60, true); // jumped to 1:00
    expect(c.now(1.1)).toBeCloseTo(60, 9);
    expect(c.epoch).toBe(epoch + 1);
    c.observe(1.2, 30, true); // and back to 0:30
    expect(c.now(1.2)).toBeCloseTo(30, 9);
  });

  it('reports a stall when playing but time stops moving (ad or buffering)', () => {
    const c = new VideoClock();
    c.observe(0, 0, false);
    c.observe(1, 0.1, true);
    c.observe(1.2, 0.3, true);
    expect(c.stalled(1.5)).toBe(false);
    expect(c.now(1.5)).not.toBeNull();
    expect(c.stalled(3)).toBe(true);
    expect(c.now(3)).toBeNull();
    c.observe(3.1, 0.4, true);
    expect(c.stalled(3.1)).toBe(false);
  });
});
