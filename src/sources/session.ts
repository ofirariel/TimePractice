import { beatToTime, timeToBeats, timeToPosition, type Grid, type Position } from '../core/grid';
import { createSchedule, scheduleSeed, type ScheduleOptions } from '../core/schedule';
import type { Silence, SilenceUnit } from '../core/schedule-random';
import { clipSilences, SilenceCursor } from '../core/silence-cursor';
import { outputDelay } from './audio-context';
import type { BeatLevel, ClickSound } from './click-sounds';
import { Metronome } from './metronome';
import { MuteGate } from './mute-gate';
import { LOOKAHEAD_SECONDS, startTicker, type Ticker } from './scheduler';

/** Breathing room between pressing Start and the first click, so it's never cut short. */
const START_DELAY_SECONDS = 0.2;

export interface SessionConfig {
  bpm: number;
  beatsPerBar: number;
  /** Level of each beat in the bar (index 0 = the "1"). */
  beatLevels: BeatLevel[];
  sound: ClickSound;
  volume: number;
  /** null = metronome only, no silences. */
  schedule: ScheduleOptions | null;
}

export interface SessionSummary {
  bpm: number;
  beatsPerBar: number;
  unit: SilenceUnit | null;
  seed: string | null;
  durationSeconds: number;
  /** Beats heard (exclusive end of the session in beat indices). */
  totalBeats: number;
  /** First beat of the session (default 0). A YouTube session starts wherever the video was. */
  startBeat?: number;
  /** Source time (seconds) of beat 0, e.g. the video's first downbeat (default 0). */
  offsetSeconds?: number;
  silences: Silence[];
}

export class PracticeSession {
  readonly grid: Grid;
  private readonly gate: MuteGate;
  private readonly metronome: Metronome;
  private readonly cursor: SilenceCursor;
  private readonly ticker: Ticker;
  private nextBeat = 0;
  private beatLevels: BeatLevel[];

  constructor(
    private readonly ctx: AudioContext,
    private readonly config: SessionConfig,
  ) {
    this.gate = new MuteGate(ctx, ctx.destination, config.volume);
    this.metronome = new Metronome(ctx, this.gate.input, config.sound);
    this.beatLevels = config.beatLevels;
    this.cursor = new SilenceCursor(config.schedule ? createSchedule(config.schedule) : null);
    this.grid = { bpm: config.bpm, beatsPerBar: config.beatsPerBar, offset: ctx.currentTime + START_DELAY_SECONDS };
    this.ticker = startTicker(() => this.tick());
    this.tick();
  }

  /** Books every click and mute that falls inside the lookahead window. */
  private tick(): void {
    const horizon = this.ctx.currentTime + LOOKAHEAD_SECONDS;
    for (;;) {
      const time = beatToTime(this.grid, this.nextBeat);
      if (time >= horizon) return;
      const event = this.cursor.at(this.nextBeat);
      if (event === 'mute') this.gate.muteAt(time);
      else if (event === 'unmute') this.gate.unmuteAt(time);
      // If the page stalled and this beat is already in the past, skip its click rather than play it late.
      if (time >= this.ctx.currentTime) {
        this.metronome.click(time, this.beatLevels[this.nextBeat % this.grid.beatsPerBar] ?? 'normal');
      }
      this.nextBeat++;
    }
  }

  /** Time on the audio clock of what is coming out of the speakers right now. */
  private heardTime(): number {
    return this.ctx.currentTime - outputDelay(this.ctx);
  }

  /** The bar/beat being heard now, or null during the short lead-in. */
  position(): Position | null {
    const pos = timeToPosition(this.grid, this.heardTime());
    return pos.beatIndex < 0 ? null : pos;
  }

  elapsedSeconds(): number {
    return Math.max(0, this.heardTime() - this.grid.offset);
  }

  setVolume(volume: number): void {
    this.gate.setVolume(volume);
  }

  /** Takes effect from the next click booked, about a tenth of a second later. */
  setClickSound(sound: ClickSound): void {
    this.metronome.sound = sound;
  }

  setBeatLevels(levels: BeatLevel[]): void {
    this.beatLevels = levels;
  }

  stop(): SessionSummary {
    this.ticker.stop();
    this.gate.close();
    const totalBeats = Math.max(0, Math.floor(timeToBeats(this.grid, this.heardTime()) + 1e-9) + 1);
    const s = this.config.schedule;
    return {
      bpm: this.grid.bpm,
      beatsPerBar: this.grid.beatsPerBar,
      unit: s?.unit ?? null,
      seed: scheduleSeed(s),
      durationSeconds: this.elapsedSeconds(),
      totalBeats,
      silences: clipSilences(this.cursor.started, totalBeats),
    };
  }
}
