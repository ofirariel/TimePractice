import { timeToBeats, timeToPosition, type Grid, type Position } from '../core/grid';
import { generateSchedule, scheduleSeed, type ScheduleOptions } from '../core/schedule';
import { clipSilences } from '../core/silence-cursor';
import { outputDelay } from './audio-context';
import type { BeatLevel, ClickSound } from './click-sounds';
import { planFilePlayback } from './file-plan';
import { Metronome } from './metronome';
import { MuteGate } from './mute-gate';
import type { SessionSummary } from './session';

/** Audio files longer than this are refused: a decoded file uses a lot of memory. */
export const MAX_FILE_SECONDS = 10 * 60;

const START_DELAY_SECONDS = 0.08;

/**
 * Plays a decoded audio file through the shared mute gate, with every silence and
 * optional click booked ahead on the audio clock.
 */
export class FileSession {
  private source: AudioBufferSourceNode | null;
  private readonly gate: MuteGate;
  private readonly audioStart: number;
  private readonly duration: number;
  private stoppedAt: number | null = null;
  private summary: SessionSummary | null = null;
  private onEnd: ((summary: SessionSummary) => void) | null;

  constructor(
    private readonly ctx: AudioContext,
    buffer: AudioBuffer,
    private readonly grid: Grid,
    private readonly schedule: ScheduleOptions | null,
    volume: number,
    click: { sound: ClickSound; beatLevels: BeatLevel[] } | null,
    onEnd: (summary: SessionSummary) => void,
  ) {
    this.onEnd = onEnd;
    this.duration = buffer.duration;
    this.gate = new MuteGate(ctx, ctx.destination, volume);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gate.input);
    this.source = source;
    const start = ctx.currentTime + START_DELAY_SECONDS;
    this.audioStart = start;
    const metronome = click ? new Metronome(ctx, this.gate.input, click.sound) : null;
    for (const event of planFilePlayback({ grid, duration: buffer.duration, schedule, beatLevels: click?.beatLevels ?? null })) {
      const when = start + event.time;
      if (event.kind === 'mute') this.gate.muteAt(when);
      else if (event.kind === 'unmute') this.gate.unmuteAt(when);
      else metronome?.click(when, event.level ?? 'normal');
    }
    source.onended = () => this.finish(this.stoppedAt ?? buffer.duration);
    source.start(start);
  }

  /** File position being heard right now. */
  private heardTime(): number {
    return this.ctx.currentTime - outputDelay(this.ctx) - this.audioStart;
  }

  position(): Position | null {
    const time = this.heardTime();
    if (time < 0 || time > this.duration) return null;
    const position = timeToPosition(this.grid, time);
    return position.beatIndex < 0 ? null : position;
  }

  elapsed(): number {
    return Math.max(0, Math.min(this.duration, this.heardTime()));
  }

  setVolume(volume: number): void {
    this.gate.setVolume(volume);
  }

  stop(): SessionSummary {
    const time = Math.max(0, Math.min(this.duration, this.heardTime()));
    this.stoppedAt = time;
    try {
      this.source?.stop();
    } catch {
      // Already stopped, for instance because the file ended.
    }
    this.source = null;
    return this.finish(time);
  }

  private finish(fileTime: number): SessionSummary {
    if (this.summary) return this.summary;
    this.gate.close();
    const heard = Math.max(0, Math.min(this.duration, fileTime));
    const totalBeats = Math.max(0, Math.floor(timeToBeats(this.grid, heard) + 1e-9) + 1);
    const silences = this.schedule ? clipSilences(generateSchedule(this.schedule, totalBeats + this.grid.beatsPerBar), totalBeats) : [];
    this.summary = {
      bpm: this.grid.bpm,
      beatsPerBar: this.grid.beatsPerBar,
      unit: this.schedule?.unit ?? null,
      seed: scheduleSeed(this.schedule),
      durationSeconds: heard,
      totalBeats,
      startBeat: 0,
      offsetSeconds: this.grid.offset,
      silences,
    };
    const done = this.onEnd;
    this.onEnd = null;
    done?.(this.summary);
    return this.summary;
  }
}
