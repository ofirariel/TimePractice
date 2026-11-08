import { LIMITS, type Settings } from '../state/settings';
import { NumberField, Row, Toggle } from './controls';

interface Props {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  locked: boolean;
}

export function MetronomeSettings({ settings, update, locked }: Props) {
  return (
    <section class="card">
      <h2>Metronome</h2>
      <fieldset disabled={locked}>
        <Row label="Tempo" hint="Beats per minute">
          <NumberField
            label="Tempo"
            suffix="BPM"
            value={settings.bpm}
            min={LIMITS.bpm.min}
            max={LIMITS.bpm.max}
            step={1}
            onChange={(bpm) => update({ bpm })}
          />
        </Row>
        <Row label="Time signature">
          <div class="time-sig">
            <NumberField
              label="Beats per bar"
              value={settings.beatsPerBar}
              min={LIMITS.beatsPerBar.min}
              max={LIMITS.beatsPerBar.max}
              step={1}
              onChange={(beatsPerBar) => update({ beatsPerBar })}
            />
            <span class="slash">/</span>
            <select aria-label="Beat value" value={settings.beatUnit} onChange={(e) => update({ beatUnit: Number(e.currentTarget.value) })}>
              {LIMITS.beatUnits.map((u) => (
                <option value={u}>{u}</option>
              ))}
            </select>
          </div>
        </Row>
        <Toggle label="Accent the 1" checked={settings.accent} onChange={(accent) => update({ accent })} />
      </fieldset>
      <Row label="Volume">
        <input
          type="range"
          class="slider"
          aria-label="Volume"
          min={0}
          max={1}
          step={0.01}
          value={settings.volume}
          onInput={(e) => update({ volume: Number(e.currentTarget.value) })}
        />
      </Row>
    </section>
  );
}
