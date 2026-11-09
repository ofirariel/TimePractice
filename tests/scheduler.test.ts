import { afterEach, describe, expect, it, vi } from 'vitest';
import { startTicker } from '../src/sources/scheduler';

describe('scheduler', () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  function stubUrl() {
    URL.createObjectURL = () => 'blob:tick';
    URL.revokeObjectURL = () => {};
  }

  it('keeps ticking when a worker cannot be started', () => {
    vi.useFakeTimers();
    const ticks: number[] = [];
    const ticker = startTicker(() => ticks.push(1), 25);
    vi.advanceTimersByTime(500);
    ticker.stop();
    expect(ticks.length).toBeGreaterThan(5);
  });

  it('uses a page timer when the worker never sends a tick', () => {
    vi.useFakeTimers();
    stubUrl();
    class SilentWorker {
      onmessage: (() => void) | null = null;
      onerror: (() => void) | null = null;
      postMessage() {}
      terminate() {}
    }
    vi.stubGlobal('Worker', SilentWorker);
    const ticks: number[] = [];
    const ticker = startTicker(() => ticks.push(1), 25);
    vi.advanceTimersByTime(149);
    expect(ticks).toEqual([]);
    vi.advanceTimersByTime(200);
    ticker.stop();
    expect(ticks.length).toBeGreaterThan(3);
  });

  it('falls back to a page timer if the worker reports an error', () => {
    vi.useFakeTimers();
    stubUrl();
    class BrokenWorker {
      onmessage: (() => void) | null = null;
      onerror: (() => void) | null = null;
      postMessage() {
        this.onerror?.();
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', BrokenWorker);
    const ticks: number[] = [];
    const ticker = startTicker(() => ticks.push(1), 25);
    vi.advanceTimersByTime(100);
    ticker.stop();
    expect(ticks.length).toBeGreaterThan(2);
  });

  it('follows the worker once it starts, without a second timer doubling the ticks', () => {
    vi.useFakeTimers();
    stubUrl();
    class LiveWorker {
      onmessage: (() => void) | null = null;
      private timer: ReturnType<typeof setInterval> | null = null;
      postMessage(ms: number) {
        this.timer = setInterval(() => this.onmessage?.(), ms);
      }
      terminate() {
        if (this.timer !== null) clearInterval(this.timer);
      }
    }
    vi.stubGlobal('Worker', LiveWorker);
    const ticks: number[] = [];
    const ticker = startTicker(() => ticks.push(1), 25);
    vi.advanceTimersByTime(500);
    ticker.stop();
    expect(ticks.length).toBeGreaterThanOrEqual(18);
    expect(ticks.length).toBeLessThanOrEqual(22);
  });
});
