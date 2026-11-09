import type { Position } from '../core/grid';
import { formatClock } from '../core/format';

interface Props {
  running: boolean;
  position: Position | null;
  elapsed: number;
  beatsPerBar: number;
  beatUnit: number;
  bpm: number;
  silencesOn: boolean;
  onToggle: () => void;
}

export function PlayPanel({ running, position, elapsed, beatsPerBar, beatUnit, bpm, silencesOn, onToggle }: Props) {
  const showing = running && position;
  return (
    <section class="card play">
      <div class="counter" aria-live="off">
        <div class="counter-cell">
          <span class="counter-label">Bar</span>
          <span class="counter-value">{showing ? position.bar + 1 : '–'}</span>
        </div>
        <div class="counter-cell">
          <span class="counter-label">Beat</span>
          <span class="counter-value beat">{showing ? position.beat + 1 : '–'}</span>
        </div>
      </div>
      <div class="beat-dots" aria-hidden="true">
        {Array.from({ length: beatsPerBar }, (_, i) => (
          <span class={`dot${i === 0 ? ' first' : ''}${showing && position.beat === i ? ' on' : ''}`} />
        ))}
      </div>
      <div class="play-meta">
        <span>
          {bpm} BPM · {beatsPerBar}/{beatUnit}
        </span>
        <span>{running ? formatClock(elapsed) : silencesOn ? 'Random silences on' : 'Silences off'}</span>
      </div>
      <button type="button" class={`play-button${running ? ' stop' : ''}`} onClick={onToggle}>
        {running ? 'Stop' : 'Start'}
      </button>
    </section>
  );
}
