import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beatToTime, type Grid } from '../src/core/grid';
import { generateSchedule, type ScheduleOptions } from '../src/core/schedule';
import { generateRandomSchedule } from '../src/core/schedule-random';
import { PlayerState, type YTPlayer } from '../src/sources/youtube-player';
import { YouTubeEngine } from '../src/sources/youtube-session';

/** A stand-in for the embedded player: real time advances smoothly, reports are coarse (every 250 ms). */
class FakePlayer implements YTPlayer {
  state: number = PlayerState.CUED;
  rate = 1;
  muted = false;
  /** Video time when playback (re)started and the wall time it happened. */
  private from = 0;
  private since = 0;
  frozen = false;
  events: { at: number; video: number; muted: boolean }[] = [];

  now() {
    return performance.now() / 1000;
  }
  trueTime() {
    if (this.state !== PlayerState.PLAYING || this.frozen) return this.from;
    return this.from + (this.now() - this.since);
  }
  playVideo() {
    this.from = this.trueTime();
    this.since = this.now();
    this.state = PlayerState.PLAYING;
  }
  pauseVideo() {
    this.from = this.trueTime();
    this.state = PlayerState.PAUSED;
  }
  freeze(on: boolean) {
    this.from = this.trueTime();
    this.since = this.now();
    this.frozen = on;
  }
  mute() {
    this.muted = true;
    this.events.push({ at: this.now(), video: this.trueTime(), muted: true });
  }
  unMute() {
    this.muted = false;
    this.events.push({ at: this.now(), video: this.trueTime(), muted: false });
  }
  isMuted() {
    return this.muted;
  }
  getCurrentTime() {
    return Math.floor(this.trueTime() * 4) / 4;
  }
  getDuration() {
    return 300;
  }
  getPlayerState() {
    return this.state;
  }
  getPlaybackRate() {
    return this.rate;
  }
  destroy() {}
}

const grid: Grid = { bpm: 120, beatsPerBar: 4, offset: 0.37 };
const options: ScheduleOptions & { mode: 'random' } = {
  mode: 'random', unit: 'bars', length: { min: 1, max: 2 }, gap: { min: 1, max: 3 }, chance: 1, grace: 2, bpm: 120, beatsPerBar: 4, seed: 'yt',
};

function run(ms: number) {
  for (let i = 0; i < ms; i++) vi.advanceTimersByTime(1);
}

describe('YouTube engine', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('mutes and unmutes on the beat, early by the calibration', () => {
    const player = new FakePlayer();
    const engine = new YouTubeEngine(player, grid);
    engine.calibration = 0.05;
    run(100);
    engine.startPractice(options);
    expect(player.state).toBe(PlayerState.PLAYING);
    run(60_000);
    const summary = engine.stopPractice()!;
    engine.destroy();

    // Playback is first detected at ~0.25 s, so practice starts at the next bar line: the downbeat at 0.37 s.
    expect(summary.startBeat).toBe(0);
    const expected = generateRandomSchedule(options, 1000)
      .filter((s) => beatToTime(grid, s.endBeat) - 0.05 < 59);
    expect(expected.length).toBeGreaterThan(5);
    const mutes = player.events.filter((e) => e.muted);
    const unmutes = player.events.filter((e) => !e.muted);
    expect(mutes.length).toBe(expected.length);
    expected.forEach((s, i) => {
      // Each command goes out within a few ms of (beat time - calibration).
      expect(Math.abs(mutes[i].video - (beatToTime(grid, s.startBeat) - 0.05))).toBeLessThan(0.006);
      expect(Math.abs(unmutes[i].video - (beatToTime(grid, s.endBeat) - 0.05))).toBeLessThan(0.006);
    });
    expect(summary.silences.slice(0, expected.length - 1)).toEqual(expected.slice(0, expected.length - 1));
    expect(summary.offsetSeconds).toBe(0.37);
    expect(summary.durationSeconds).toBeGreaterThan(59);
    expect(player.muted).toBe(false);
  });

  it('fixed mode mutes the video for the last 2 of every 4 bars', () => {
    const player = new FakePlayer();
    const engine = new YouTubeEngine(player, grid);
    engine.calibration = 0;
    const fixed: ScheduleOptions = { mode: 'fixed', unit: 'bars', silence: 2, every: 4, grace: 0, bpm: 120, beatsPerBar: 4 };
    engine.startPractice(fixed);
    run(40_000);
    const summary = engine.stopPractice()!;
    engine.destroy();

    const expected = generateSchedule(fixed, 1000).filter((s) => beatToTime(grid, s.endBeat) < 39);
    // Bars 3-4, 7-8, 11-12, ... : 8 s cycles at 120 BPM in 4/4.
    expect(expected.slice(0, 2)).toEqual([{ startBeat: 8, endBeat: 16 }, { startBeat: 24, endBeat: 32 }]);
    const mutes = player.events.filter((e) => e.muted);
    const unmutes = player.events.filter((e) => !e.muted);
    expected.forEach((s, i) => {
      expect(Math.abs(mutes[i].video - beatToTime(grid, s.startBeat))).toBeLessThan(0.006);
      expect(Math.abs(unmutes[i].video - beatToTime(grid, s.endBeat))).toBeLessThan(0.006);
    });
    expect(summary.seed).toBeNull();
  });

  it('puts silences on hold while paused and resumes them in place', () => {
    const player = new FakePlayer();
    const engine = new YouTubeEngine(player, grid);
    engine.calibration = 0;
    engine.startPractice({ ...options, grace: 0, gap: { min: 1, max: 1 }, length: { min: 4, max: 4 } });
    // First silence: bars 2-5 (beats 4-20), i.e. video 2.37 s to 10.37 s.
    run(4000);
    expect(player.muted).toBe(true);
    player.pauseVideo();
    run(100);
    expect(player.muted).toBe(false);
    expect(engine.videoStatus()).toBe('paused');
    run(5000);
    expect(player.muted).toBe(false);
    player.playVideo();
    run(600);
    expect(player.muted).toBe(true);
    engine.destroy();
  });

  it('unmutes and waits when the video stops moving (an ad or buffering)', () => {
    const player = new FakePlayer();
    const engine = new YouTubeEngine(player, grid);
    engine.startPractice({ ...options, grace: 0, gap: { min: 1, max: 1 }, length: { min: 4, max: 4 } });
    run(4000);
    expect(player.muted).toBe(true);
    player.freeze(true);
    run(2000);
    expect(engine.videoStatus()).toBe('waiting');
    expect(player.muted).toBe(false);
    player.freeze(false);
    run(800);
    expect(engine.videoStatus()).toBe('playing');
    expect(player.muted).toBe(true);
    engine.destroy();
  });

  it('ignores the schedule when the speed is not normal', () => {
    const player = new FakePlayer();
    const engine = new YouTubeEngine(player, grid);
    engine.startPractice({ ...options, grace: 0, gap: { min: 1, max: 1 }, length: { min: 4, max: 4 } });
    player.rate = 1.5;
    run(5000);
    expect(engine.videoStatus()).toBe('speed');
    expect(player.events.length).toBe(0);
    engine.destroy();
  });

  it('reports the bar and beat of the video', () => {
    const player = new FakePlayer();
    const engine = new YouTubeEngine(player, grid);
    player.playVideo();
    run(5000);
    const p = engine.position()!;
    // 5.0 s with the first downbeat at 0.37 s and 0.5 s beats: beat 9 (bar 3, beat 2).
    expect(p.beatIndex).toBe(9);
    expect(p.bar).toBe(2);
    expect(p.beat).toBe(1);
    expect(engine.stopPractice()).toBeNull();
    engine.destroy();
  });
});

/** Just enough of an AudioContext for the click overlay; records every click booked. */
class FakeAudioContext {
  state: AudioContextState = 'running';
  sampleRate = 48000;
  destination = {};
  baseLatency = 0.01;
  outputLatency = 0;
  /** How far behind currentTime the speakers are, as reported by getOutputTimestamp(). */
  speakerDelay = 0.03;
  bogusStamp = false;
  private frozenAt = 0;
  private startedAt = performance.now() / 1000;
  booked: { when: number; now: number }[] = [];

  get currentTime() {
    return this.state === 'running' ? performance.now() / 1000 - this.startedAt : this.frozenAt;
  }
  suspend() {
    this.frozenAt = this.currentTime;
    this.state = 'suspended';
  }
  /** When set, resume() leaves the context suspended so a test can hold that state. */
  holdResume = false;
  resume() {
    if (this.holdResume) return;
    this.startedAt = performance.now() / 1000 - this.frozenAt;
    this.state = 'running';
  }
  getOutputTimestamp() {
    if (this.state !== 'running') return { contextTime: 0, performanceTime: 0 };
    if (this.bogusStamp) return { contextTime: this.currentTime + 40, performanceTime: performance.now() };
    return { contextTime: this.currentTime - this.speakerDelay, performanceTime: performance.now() };
  }
  createGain() {
    return { gain: { value: 1, setTargetAtTime() {} }, connect: () => ({}), disconnect() {} };
  }
  createBuffer(_channels: number, length: number) {
    return { length, copyToChannel() {} };
  }
  createBufferSource() {
    return { buffer: null, connect() {}, start: (when: number) => this.booked.push({ when, now: this.currentTime }) };
  }
}

describe('YouTube click overlay', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(ctx: FakeAudioContext) {
    const player = new FakePlayer();
    const engine = new YouTubeEngine(player, grid);
    engine.setClickOverlay({ ctx: ctx as unknown as AudioContext, sound: 'classic', beatLevels: ['accent', 'normal', 'normal', 'normal'], volume: 1 });
    player.playVideo();
    return { player, engine };
  }

  /** Every beat between 1 s and 9 s of video should get exactly one click, booked ahead of the audio clock. */
  function expectOneClickPerBeat(ctx: FakeAudioContext) {
    const future = ctx.booked.filter((b) => b.when >= b.now);
    expect(future.length).toBe(ctx.booked.length);
    // Beats at 0.37 + 0.5 k: 16 beats fall in a 8 s window.
    const inWindow = ctx.booked.filter((b) => b.when > 1 && b.when <= 9);
    expect(inWindow.length).toBeGreaterThanOrEqual(15);
    expect(inWindow.length).toBeLessThanOrEqual(17);
    const gaps = inWindow.slice(1).map((b, i) => b.when - inWindow[i].when);
    gaps.forEach((g) => expect(Math.abs(g - 0.5)).toBeLessThan(0.01));
  }

  it('books one click per beat ahead of the audio clock', () => {
    const ctx = new FakeAudioContext();
    const { engine } = setup(ctx);
    run(10_000);
    expectOneClickPerBeat(ctx);
    engine.destroy();
  });

  it('still clicks when the speakers lag far behind (Android, Bluetooth)', () => {
    const ctx = new FakeAudioContext();
    ctx.speakerDelay = 0.3;
    const { engine } = setup(ctx);
    run(10_000);
    expectOneClickPerBeat(ctx);
    engine.destroy();
  });

  it('falls back to a simple mapping when the browser reports a nonsense output timestamp', () => {
    const ctx = new FakeAudioContext();
    ctx.bogusStamp = true;
    const { engine } = setup(ctx);
    run(10_000);
    expectOneClickPerBeat(ctx);
    engine.destroy();
  });

  it('books nothing while audio is suspended, then clicks normally once resumed', () => {
    const ctx = new FakeAudioContext();
    ctx.suspend();
    ctx.holdResume = true;
    const { engine } = setup(ctx);
    run(3000);
    expect(ctx.booked).toEqual([]);
    ctx.holdResume = false;
    ctx.resume();
    run(10_000);
    expect(ctx.booked.length).toBeGreaterThan(15);
    expect(ctx.booked.every((b) => b.when >= b.now)).toBe(true);
    // No burst of stacked-up clicks: they stay half a second apart.
    ctx.booked.slice(1).forEach((b, i) => expect(b.when - ctx.booked[i].when).toBeGreaterThan(0.49));
    engine.destroy();
  });
});
