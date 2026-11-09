import type { TapResult } from '../core/tap-align';
import { LIMITS } from '../state/settings';
import type { VideoGrid } from '../state/youtube-settings';
import { NumberField, Row, Toggle } from './controls';

export type ListenPhase = 'idle' | 'asking' | 'listening' | 'finding';

interface Props {
  grid: VideoGrid;
  locked: boolean;
  taps: number;
  tapResult: TapResult | null;
  tapHint: string | null;
  clickOn: boolean;
  /** Android listens with the microphone; a computer shares the tab's audio. */
  listenWithMic: boolean;
  listenPhase: ListenPhase;
  heardSeconds: number;
  listenSeconds: number;
  listenMessage: string | null;
  onTempo: (patch: Partial<Pick<VideoGrid, 'bpm' | 'beatsPerBar' | 'beatUnit'>>) => void;
  onScale: (factor: number) => void;
  onTap: (timeStamp: number) => void;
  onResetTaps: () => void;
  onNudge: (seconds: number) => void;
  onClick: (on: boolean) => void;
  onDetect: () => void;
  onStopListen: () => void;
}

const UNEVEN_TAPS_MS = 60;

function tapMessage(taps: number, result: TapResult | null, hint: string | null): string {
  if (hint) return hint;
  if (taps === 0) return 'Play the video and tap this button on every "1".';
  if (!result) return 'Keep tapping on every "1"…';
  if (result.spreadMs > UNEVEN_TAPS_MS) return `${taps} taps, but they're uneven. Keep tapping, or check the tempo and time signature.`;
  return `Lined up from ${taps} taps. Turn on the click below to check.`;
}

export function YouTubeAlign({
  grid,
  locked,
  taps,
  tapResult,
  tapHint,
  clickOn,
  listenWithMic,
  listenPhase,
  heardSeconds,
  listenSeconds,
  listenMessage,
  onTempo,
  onScale,
  onTap,
  onResetTaps,
  onNudge,
  onClick,
  onDetect,
  onStopListen,
}: Props) {
  const beat = 60 / grid.bpm;
  const listening = listenPhase === 'listening' || listenPhase === 'asking' || listenPhase === 'finding';
  const left = Math.max(0, Math.ceil(listenSeconds - heardSeconds));
  return (
    <section class="card">
      <h2>Line up the beat</h2>
      <fieldset disabled={locked || listening}>
        <Row label="Track tempo" hint="Fine-tune by 0.1 if the click slowly drifts away from the music">
          <NumberField
            label="Track tempo"
            suffix="BPM"
            value={grid.bpm}
            min={LIMITS.bpm.min}
            max={LIMITS.bpm.max}
            step={0.1}
            onChange={(bpm) => onTempo({ bpm })}
          />
        </Row>
        <Row label="Half or double?">
          <div class="nudge-grid">
            <button type="button" onClick={() => onScale(0.5)} disabled={grid.bpm / 2 < LIMITS.bpm.min}>
              ÷2 slower
            </button>
            <button type="button" onClick={() => onScale(2)} disabled={grid.bpm * 2 > LIMITS.bpm.max}>
              ×2 faster
            </button>
          </div>
        </Row>
        <Row label="Time signature">
          <div class="time-sig">
            <NumberField
              label="Beats per bar"
              value={grid.beatsPerBar}
              min={LIMITS.beatsPerBar.min}
              max={LIMITS.beatsPerBar.max}
              step={1}
              onChange={(beatsPerBar) => onTempo({ beatsPerBar })}
            />
            <span class="slash">/</span>
            <select aria-label="Beat value" value={grid.beatUnit} onChange={(e) => onTempo({ beatUnit: Number(e.currentTarget.value) })}>
              {LIMITS.beatUnits.map((u) => (
                <option value={u}>{u}</option>
              ))}
            </select>
          </div>
        </Row>
      </fieldset>

      <div class="listen-block">
        <p class="muted small-note listen-note">
          {listenWithMic
            ? 'This phone listens through the microphone, so it can hear its own speaker. Turn the volume up, play the video, and keep the phone where it can hear the track.'
            : 'Play the video. Chrome will ask to share this tab — choose this tab and turn on Share tab audio.'}
        </p>
        {listenPhase === 'listening' ? (
          <p class="status-note" role="status">
            Listening… {left}s left. Keep the video playing.
          </p>
        ) : listenPhase === 'asking' ? (
          <p class="status-note" role="status">
            {listenWithMic ? 'Allow the microphone to hear the speaker.' : 'Choose this tab and turn on Share tab audio.'}
          </p>
        ) : listenPhase === 'finding' ? (
          <p class="status-note" role="status">
            Finding the beat…
          </p>
        ) : null}
        {listenMessage && listenPhase === 'idle' && (
          <p class="status-note" role="status">
            {listenMessage}
          </p>
        )}
        {listenPhase === 'listening' ? (
          <button type="button" class="listen-button stop" onClick={onStopListen}>
            Stop listening
          </button>
        ) : (
          <button type="button" class="listen-button" disabled={locked || listening} onClick={onDetect}>
            Detect tempo
          </button>
        )}
      </div>

      <fieldset disabled={locked || listening}>
        <div class="tap-area">
          <button
            type="button"
            class="tap-button"
            onPointerDown={(e) => {
              e.preventDefault();
              onTap(e.timeStamp);
            }}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                if (!e.repeat) onTap(e.timeStamp);
              }
            }}
          >
            Tap on the 1
          </button>
          <p class="tap-message" aria-live="polite">
            {tapMessage(taps, tapResult, tapHint)}
          </p>
          {taps > 0 && (
            <button type="button" class="small-button" onClick={onResetTaps}>
              Start tapping again
            </button>
          )}
        </div>
      </fieldset>

      <Toggle label="Play a click with the video" checked={clickOn} disabled={locked || listening} onChange={onClick} />

      <fieldset disabled={locked || listening}>
        <Row label="Click too early or late?" hint="Move the bars until the click sits right on the music">
          <div class="nudge-grid">
            <button type="button" onClick={() => onNudge(-0.01)}>
              ← 10 ms earlier
            </button>
            <button type="button" onClick={() => onNudge(0.01)}>
              10 ms later →
            </button>
          </div>
        </Row>
        <Row label="The 1 is on the wrong beat?">
          <div class="nudge-grid">
            <button type="button" onClick={() => onNudge(-beat)}>
              ← 1 beat earlier
            </button>
            <button type="button" onClick={() => onNudge(beat)}>
              1 beat later →
            </button>
          </div>
        </Row>
      </fieldset>
      {!grid.aligned && <p class="muted small-note">Not lined up yet: bar 1 starts at the very beginning of the video.</p>}
    </section>
  );
}
