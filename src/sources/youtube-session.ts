import { beatToTime, timeToBeats, timeToPosition, type Grid, type Position } from '../core/grid';
import { generateSchedule, scheduleSeed, type ScheduleOptions } from '../core/schedule';
import type { Silence } from '../core/schedule-random';
import { nextBoundary, shiftSilences, silenceAt } from '../core/silence-lookup';
import { clipSilences } from '../core/silence-cursor';
import { VideoClock } from '../core/video-clock';
import type { BeatLevel, ClickSound } from './click-sounds';
import { Metronome } from './metronome';
import { startTicker, type Ticker } from './scheduler';
import type { SessionSummary } from './session';
import { PlayerState, type YTPlayer } from './youtube-player';

/** Polling interval. Reading the player is cheap: it returns values cached in the page. */
const POLL_MS = 10;
/** If the next mute change is closer than this, a one-off timer fires it exactly on time. */
const PRECISE_WINDOW_SECONDS = 0.02;
const CLICK_LOOKAHEAD_SECONDS = 0.12;
/** Fallback length when the player doesn't report the video's duration. */
const FALLBACK_DURATION_SECONDS = 3600;

export type VideoStatus = 'idle' | 'playing' | 'paused' | 'buffering' | 'waiting' | 'speed' | 'ended';

export interface ClickOverlay {
  ctx: AudioContext;
  sound: ClickSound;
  beatLevels: BeatLevel[];
  volume: number;
}

interface Practice {
  options: ScheduleOptions | null;
  /** First beat of practice (a bar line), or null until the video starts playing. */
  anchorBeat: number | null;
  silences: Silence[];
  heard: Set<Silence>;
  maxBeat: number;
  playedSeconds: number;
}

/** Wall-clock seconds on the same timeline as event.timeStamp. */
export function wallNow(): number {
  return performance.now() / 1000;
}

/**
 * Drives practice on top of an embedded YouTube player: keeps a smooth estimate of the
 * playback position, mutes the player (slightly early, to make up for its delay) during
 * silences, and optionally plays a Web Audio click in time with the video.
 */
export class YouTubeEngine {
  private readonly clock = new VideoClock();
  private readonly ticker: Ticker;
  private grid: Grid;
  private practice: Practice | null = null;
  private muted = false;
  private preciseTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTickAt = wallNow();
  private status: VideoStatus = 'idle';

  private click: { overlay: ClickOverlay; metronome: Metronome; gain: GainNode; epoch: number; lastBeat: number | null } | null = null;

  /** Mutes and unmutes are sent this many seconds early. */
  calibration = 0;

  constructor(
    private readonly player: YTPlayer,
    grid: Grid,
  ) {
    this.grid = { ...grid };
    this.ticker = startTicker(() => this.tick(), POLL_MS);
  }

  setGrid(grid: Grid): void {
    this.grid = { ...grid };
    this.click && (this.click.lastBeat = null);
  }

  videoStatus(): VideoStatus {
    return this.status;
  }

  /** Playback position as heard, or null while the video isn't playing smoothly. */
  videoTime(at = wallNow()): number | null {
    return this.clock.now(at);
  }

  /** Bar and beat of the video right now (bar 0 = first bar of the track). */
  position(): Position | null {
    const t = this.videoTime();
    return t === null ? null : timeToPosition(this.grid, t);
  }

  isPracticing(): boolean {
    return this.practice !== null;
  }

  /** True once practice has a starting bar (the video has started playing). */
  practiceStarted(): boolean {
    return this.practice?.anchorBeat != null;
  }

  practiceSeconds(): number {
    return this.practice?.playedSeconds ?? 0;
  }

  setClickOverlay(overlay: ClickOverlay | null): void {
    if (!overlay) {
      this.click?.gain.disconnect();
      this.click = null;
      return;
    }
    if (this.click && this.click.overlay.ctx === overlay.ctx) {
      this.click.overlay = overlay;
      this.click.metronome.sound = overlay.sound;
      this.click.gain.gain.setTargetAtTime(overlay.volume, overlay.ctx.currentTime, 0.02);
      return;
    }
    this.click?.gain.disconnect();
    const gain = overlay.ctx.createGain();
    gain.gain.value = overlay.volume;
    gain.connect(overlay.ctx.destination);
    this.click = { overlay, metronome: new Metronome(overlay.ctx, gain, overlay.sound), gain, epoch: -1, lastBeat: null };
  }

  /** Starts practice. Silences begin from the next bar line once the video is playing. */
  startPractice(options: ScheduleOptions | null): void {
    this.practice = { options, anchorBeat: null, silences: [], heard: new Set(), maxBeat: -1, playedSeconds: 0 };
    if (this.player.getPlayerState() !== PlayerState.PLAYING) this.player.playVideo();
    this.tick();
  }

  stopPractice(): SessionSummary | null {
    const p = this.practice;
    this.practice = null;
    this.clearPreciseTimer();
    this.setMuted(false);
    if (!p || p.anchorBeat === null) return null;
    const totalBeats = Math.max(p.anchorBeat, p.maxBeat + 1);
    const heard = [...p.heard].sort((a, b) => a.startBeat - b.startBeat);
    return {
      bpm: this.grid.bpm,
      beatsPerBar: this.grid.beatsPerBar,
      unit: p.options?.unit ?? null,
      seed: scheduleSeed(p.options),
      durationSeconds: p.playedSeconds,
      totalBeats,
      startBeat: p.anchorBeat,
      offsetSeconds: this.grid.offset,
      silences: clipSilences(heard, totalBeats),
    };
  }

  destroy(): void {
    this.ticker.stop();
    this.clearPreciseTimer();
    this.setClickOverlay(null);
    if (this.muted) this.player.unMute();
  }

  private readStatus(at: number): VideoStatus {
    const state = this.player.getPlayerState();
    const rate = this.player.getPlaybackRate?.() ?? 1;
    if (state === PlayerState.PLAYING) {
      if (rate !== 1) return 'speed';
      return this.clock.stalled(at) ? 'waiting' : 'playing';
    }
    if (state === PlayerState.PAUSED) return 'paused';
    if (state === PlayerState.BUFFERING) return 'buffering';
    if (state === PlayerState.ENDED) return 'ended';
    return 'idle';
  }

  private tick(): void {
    const at = wallNow();
    const state = this.player.getPlayerState();
    const rate = this.player.getPlaybackRate?.() ?? 1;
    this.clock.observe(at, this.player.getCurrentTime() ?? 0, state === PlayerState.PLAYING && rate === 1);
    this.status = this.readStatus(at);
    const t = this.clock.now(at);

    const p = this.practice;
    if (p && t !== null) {
      if (p.anchorBeat === null) this.anchor(p, t);
      p.playedSeconds += Math.min(0.25, at - this.lastTickAt);
      p.maxBeat = Math.max(p.maxBeat, Math.floor(timeToBeats(this.grid, t)));
    }
    this.lastTickAt = at;
    this.syncMute(at);
    this.scheduleClicks(at, t);
  }

  private anchor(p: Practice, t: number): void {
    const bpb = this.grid.beatsPerBar;
    const anchorBeat = Math.max(0, Math.floor(timeToBeats(this.grid, t) / bpb) + 1) * bpb;
    p.anchorBeat = anchorBeat;
    if (!p.options) return;
    const duration = this.player.getDuration() || FALLBACK_DURATION_SECONDS;
    const until = Math.ceil(timeToBeats(this.grid, duration)) - anchorBeat + bpb;
    p.silences = shiftSilences(generateSchedule(p.options, Math.max(0, until)), anchorBeat);
  }

  /** Beat position the mute state should follow: slightly ahead of what's playing. */
  private muteBeat(t: number): number {
    return timeToBeats(this.grid, t + this.calibration);
  }

  private syncMute(at: number): void {
    const p = this.practice;
    const t = this.clock.now(at);
    if (!p || t === null || p.anchorBeat === null) {
      this.clearPreciseTimer();
      this.setMuted(false);
      return;
    }
    const beat = this.muteBeat(t);
    const s = silenceAt(p.silences, beat);
    if (s) p.heard.add(s);
    this.setMuted(s !== null);

    if (this.preciseTimer !== null) return;
    const next = nextBoundary(p.silences, beat);
    if (next === null) return;
    const wait = beatToTime(this.grid, next) - this.calibration - t;
    if (wait < PRECISE_WINDOW_SECONDS) {
      this.preciseTimer = setTimeout(() => {
        this.preciseTimer = null;
        // A hair past the boundary, so float error can't leave us just before it.
        this.syncMute(wallNow() + 0.0005);
      }, Math.max(0, wait * 1000));
    }
  }

  private setMuted(muted: boolean): void {
    if (muted === this.muted) return;
    this.muted = muted;
    if (muted) this.player.mute();
    else this.player.unMute();
  }

  private clearPreciseTimer(): void {
    if (this.preciseTimer !== null) clearTimeout(this.preciseTimer);
    this.preciseTimer = null;
  }

  /** Books clicks for beats coming up in the next ~0.1 s, mapped from video time onto the audio clock. */
  private scheduleClicks(at: number, t: number | null): void {
    const c = this.click;
    if (!c) return;
    if (t === null) {
      c.lastBeat = null;
      return;
    }
    if (c.epoch !== this.clock.epoch) {
      c.epoch = this.clock.epoch;
      c.lastBeat = null;
    }
    const { ctx, beatLevels } = c.overlay;
    const stamp = ctx.getOutputTimestamp?.();
    // Audio-clock time at which a sound will leave the speakers at wall time `wall`.
    const toCtx = (wall: number) =>
      stamp?.performanceTime && stamp.contextTime !== undefined
        ? stamp.contextTime + (wall - stamp.performanceTime / 1000)
        : ctx.currentTime + (wall - at);
    let n = c.lastBeat === null ? Math.ceil(timeToBeats(this.grid, t)) : c.lastBeat + 1;
    for (; beatToTime(this.grid, n) <= t + CLICK_LOOKAHEAD_SECONDS; n++) {
      c.lastBeat = n;
      if (n < 0) continue;
      if (this.practice && silenceAt(this.practice.silences, n)) continue;
      const when = toCtx(at + (beatToTime(this.grid, n) - t));
      if (when < ctx.currentTime) continue;
      const bpb = this.grid.beatsPerBar;
      c.metronome.click(when, beatLevels[((n % bpb) + bpb) % bpb] ?? 'normal');
    }
  }
}
