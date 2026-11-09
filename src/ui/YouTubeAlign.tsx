import type { TapResult } from '../core/tap-align';
import { LIMITS } from '../state/settings';
import type { VideoGrid } from '../state/youtube-settings';
import { NumberField, Row, Toggle } from './controls';

interface Props {
  grid: VideoGrid;
  locked: boolean;
  taps: number;
  tapResult: TapResult | null;
  tapHint: string | null;
  clickOn: boolean;
  onTempo: (patch: Partial<Pick<VideoGrid, 'bpm' | 'beatsPerBar' | 'beatUnit'>>) => void;
  onTap: (timeStamp: number) => void;
  onResetTaps: () => void;
  onNudge: (seconds: number) => void;
  onClick: (on: boolean) => void;
}

const UNEVEN_TAPS_MS = 60;

function tapMessage(taps: number, result: TapResult | null, hint: string | null): string {
  if (hint) return hint;
  if (taps === 0) return 'Play the video and tap this button on every "1".';
  if (!result) return 'Keep tapping on every "1"…';
  if (result.spreadMs > UNEVEN_TAPS_MS) return `${taps} taps, but they're uneven. Keep tapping, or check the tempo and time signature.`;
  return `Lined up from ${taps} taps. Turn on the click below to check.`;
}

export function YouTubeAlign({ grid, locked, taps, tapResult, tapHint, clickOn, onTempo, onTap, onResetTaps, onNudge, onClick }: Props) {
  const beat = 60 / grid.bpm;
  return (
    <section class="card">
      <h2>Line up the beat</h2>
      <fieldset disabled={locked}>
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

      <Toggle label="Play a click with the video" checked={clickOn} onChange={onClick} />

      <fieldset disabled={locked}>
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
