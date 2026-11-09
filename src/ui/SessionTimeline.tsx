import { describeSilence, formatClock } from '../core/format';
import type { SessionSummary } from '../sources/session';

interface Props {
  summary: SessionSummary;
  seedInUse: boolean;
  onReuseSeed: (seed: string) => void;
}

/** Picks a bar-line spacing that keeps the timeline readable for short and long sessions. */
function tickEvery(totalBars: number): number {
  for (const every of [1, 2, 4, 8, 16, 32, 64]) if (totalBars / every <= 24) return every;
  return 128;
}

export function SessionTimeline({ summary, seedInUse, onReuseSeed }: Props) {
  const { totalBeats, beatsPerBar, bpm, silences } = summary;
  const startBeat = summary.startBeat ?? 0;
  const offset = summary.offsetSeconds ?? 0;
  const firstBar = Math.floor(startBeat / beatsPerBar);
  const spanBeats = Math.max(0, totalBeats - startBeat);
  const beatSec = 60 / bpm;
  const totalBars = Math.ceil(spanBeats / beatsPerBar);
  const every = tickEvery(totalBars);
  const silentBeats = silences.reduce((sum, s) => sum + s.endBeat - s.startBeat, 0);
  const pct = (beats: number) => `${(100 * beats) / Math.max(1, spanBeats)}%`;

  return (
    <section class="card">
      <h2>Last session</h2>
      <p class="summary-line">
        {formatClock(summary.durationSeconds)} played · {totalBars} {totalBars === 1 ? 'bar' : 'bars'} ·{' '}
        {silences.length} {silences.length === 1 ? 'silence' : 'silences'}
        {silentBeats > 0 && ` · ${formatClock(silentBeats * beatSec)} silent`}
      </p>

      {spanBeats > 0 && (
        <div class="timeline" role="img" aria-label="Where the silences fell">
          {Array.from({ length: Math.floor(totalBars / every) + 1 }, (_, i) => i * every)
            .filter((bar) => bar * beatsPerBar <= spanBeats)
            .map((bar) => (
              <span class="tick" style={{ left: pct(bar * beatsPerBar) }}>
                <span class="tick-label">{firstBar + bar + 1}</span>
              </span>
            ))}
          {silences.map((s) => (
            <span class="block" style={{ left: pct(s.startBeat - startBeat), width: pct(s.endBeat - s.startBeat) }} />
          ))}
        </div>
      )}
      <div class="timeline-legend">
        <span>
          <i class="swatch sound" /> sound
        </span>
        <span>
          <i class="swatch silent" /> silence
        </span>
        <span class="muted">numbers = bar</span>
      </div>

      {silences.length > 0 && (
        <ol class="silence-list">
          {silences.map((s) => (
            <li>
              <span>{describeSilence(s, beatsPerBar)}</span>
              <span class="muted">
                at {formatClock(offset + s.startBeat * beatSec)} · {((s.endBeat - s.startBeat) * beatSec).toFixed(1)} s
              </span>
            </li>
          ))}
        </ol>
      )}

      {summary.seed !== null && (
        <div class="seed-line">
          <span>
            Pattern seed: <strong>{summary.seed}</strong>
          </span>
          {!seedInUse && (
            <button type="button" class="small-button" onClick={() => onReuseSeed(summary.seed!)}>
              Repeat this pattern
            </button>
          )}
        </div>
      )}
    </section>
  );
}
