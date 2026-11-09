import { CLICK_SOUNDS, nextBeatLevel, type BeatLevel, type ClickSound } from '../sources/click-sounds';
import { LIMITS, type Settings } from '../state/settings';
import { NumberField, Row } from './controls';

interface Props {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  onPreview: (sound: ClickSound, level: BeatLevel) => void;
  locked: boolean;
}

const LEVEL_NAMES: Record<BeatLevel, string> = { accent: 'accent', normal: 'normal', soft: 'soft', off: 'silent' };

export function MetronomeSettings({ settings, update, onPreview, locked }: Props) {
  const tapBeat = (i: number) => {
    const beatLevels = settings.beatLevels.slice();
    beatLevels[i] = nextBeatLevel(beatLevels[i]);
    update({ beatLevels });
    onPreview(settings.sound, beatLevels[i]);
  };

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
      </fieldset>
      <Row label="Beats" hint="Tap a beat to change it: accent, normal, soft, silent">
        <div class="beat-levels">
          {settings.beatLevels.slice(0, settings.beatsPerBar).map((level, i) => (
            <button type="button" class={`beat-level ${level}`} aria-label={`Beat ${i + 1}: ${LEVEL_NAMES[level]}`} onClick={() => tapBeat(i)}>
              <span class="beat-level-bar" aria-hidden="true" />
              <span class="beat-level-num">{i + 1}</span>
            </button>
          ))}
        </div>
      </Row>
      <Row label="Sound">
        <div class="sound-grid" role="radiogroup" aria-label="Click sound">
          {CLICK_SOUNDS.map((c) => (
            <button
              type="button"
              role="radio"
              aria-checked={c.value === settings.sound}
              class={c.value === settings.sound ? 'active' : ''}
              onClick={() => {
                update({ sound: c.value });
                onPreview(c.value, 'accent');
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      </Row>
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
