import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beatToTime, type Grid } from '../src/core/grid';
import { generateRandomSchedule, type RandomScheduleOptions } from '../src/core/schedule-random';
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
const options: RandomScheduleOptions = {
  unit: 'bars', length: { min: 1, max: 2 }, gap: { min: 1, max: 3 }, chance: 1, grace: 2, bpm: 120, beatsPerBar: 4, seed: 'yt',
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
