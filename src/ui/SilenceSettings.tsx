import type { Range, SilenceUnit } from '../core/schedule-random';
import { LIMITS, type Settings, type SilenceMode, type UnitValues } from '../state/settings';
import { NumberField, Row, Segmented } from './controls';

type Silence = Settings['silence'];

interface Props {
  silence: Silence;
  update: (patch: Partial<Silence>) => void;
  locked: boolean;
}

function unitLabel(unit: SilenceUnit, n: number) {
  if (unit === 'seconds') return 'sec';
  return n === 1 ? 'bar' : 'bars';
}

interface RangeFieldProps {
  name: string;
  unit: SilenceUnit;
  range: Range;
  ranged: boolean;
  onChange: (range: Range, ranged: boolean) => void;
}

function RangeField({ name, unit, range, ranged, onChange }: RangeFieldProps) {
  const lim = unit === 'bars' ? LIMITS.bars : LIMITS.seconds;
  const step = unit === 'bars' ? 1 : 0.5;
  return (
    <div class="range-field">
      <Segmented
        label={`${name}: exact or range`}
        value={ranged ? 'range' : 'fixed'}
        options={[
          { value: 'fixed', label: 'Exact' },
          { value: 'range', label: 'Range' },
        ]}
        onChange={(v) => onChange(range, v === 'range')}
      />
      <div class="range-inputs">
        <NumberField
          label={ranged ? `${name} minimum` : name}
          suffix={unitLabel(unit, range.min)}
          value={range.min}
          min={lim.min}
          max={lim.max}
          step={step}
          onChange={(min) => onChange({ min, max: Math.max(min, range.max) }, ranged)}
        />
        {ranged && (
          <>
            <span class="to">to</span>
            <NumberField
              label={`${name} maximum`}
              suffix={unitLabel(unit, range.max)}
              value={range.max}
              min={lim.min}
              max={lim.max}
              step={step}
              onChange={(max) => onChange({ min: Math.min(max, range.min), max }, ranged)}
            />
          </>
        )}
      </div>
    </div>
  );
}

const MODE_HINTS: Record<SilenceMode, string> = {
  fixed: 'The same pattern over and over: sound first, then silence.',
  random: 'Silences of varying length at unpredictable places.',
  off: 'No silences: the sound plays all the way through.',
};

function FixedFields({ unit, values, setValues }: { unit: SilenceUnit; values: UnitValues; setValues: (patch: Partial<UnitValues>) => void }) {
  const lim = unit === 'bars' ? LIMITS.bars : LIMITS.seconds;
  const step = unit === 'bars' ? 1 : 0.5;
  const { silence, every } = values.fixed;
  return (
    <>
      <Row label="Silent for">
        <NumberField
          label="Silent for"
          suffix={unitLabel(unit, silence)}
          value={silence}
          min={lim.min}
          max={lim.max - step}
          step={step}
          onChange={(n) => setValues({ fixed: { silence: n, every: Math.max(every, n + step) } })}
        />
      </Row>
      <Row label="Every">
        <NumberField
          label="Every"
          suffix={unitLabel(unit, every)}
          value={every}
          min={silence + step}
          max={lim.max}
          step={step}
          onChange={(n) => setValues({ fixed: { silence, every: n } })}
        />
      </Row>
      <p class="pattern-note">
        Plays {every - silence} {unitLabel(unit, every - silence)}, then {silence} {unitLabel(unit, silence)} of silence, and repeats.
      </p>
    </>
  );
}

export function SilenceSettings({ silence, update, locked }: Props) {
  const { unit, mode } = silence;
  const values = silence[unit];
  const setValues = (patch: Partial<UnitValues>) => update({ [unit]: { ...values, ...patch } });
  const grace = unit === 'bars' ? LIMITS.graceBars : LIMITS.graceSeconds;

  return (
    <section class="card">
      <h2>Silences</h2>
      <fieldset disabled={locked}>
        <div class="mode-switch">
          <Segmented
            label="Silence mode"
            value={mode}
            options={[
              { value: 'fixed', label: 'Fixed' },
              { value: 'random', label: 'Random' },
              { value: 'off', label: 'Off' },
            ]}
            onChange={(m) => update({ mode: m })}
          />
          <small>{MODE_HINTS[mode]}</small>
        </div>
        {mode !== 'off' && (
          <>
            <Row label="Measure in">
              <Segmented
                label="Measure silences in"
                value={unit}
                options={[
                  { value: 'bars', label: 'Bars' },
                  { value: 'seconds', label: 'Seconds' },
                ]}
                onChange={(u) => update({ unit: u })}
              />
            </Row>
            {mode === 'fixed' && <FixedFields unit={unit} values={values} setValues={setValues} />}
            {mode === 'random' && (
              <>
                <Row label="Silence length" hint="How long the click goes quiet">
                  <RangeField
                    name="Silence length"
                    unit={unit}
                    range={values.length}
                    ranged={values.lengthRanged}
                    onChange={(length, lengthRanged) => setValues({ length, lengthRanged })}
                  />
                </Row>
                <Row label="Gap between silences" hint="How long you hear the click in between">
                  <RangeField
                    name="Gap"
                    unit={unit}
                    range={values.gap}
                    ranged={values.gapRanged}
                    onChange={(gap, gapRanged) => setValues({ gap, gapRanged })}
                  />
                </Row>
              </>
            )}
            <Row label="Warm-up" hint="Nothing is muted at the start">
              <NumberField
                label="Warm-up"
                suffix={unitLabel(unit, values.grace)}
                value={values.grace}
                min={grace.min}
                max={grace.max}
                step={1}
                onChange={(g) => setValues({ grace: g })}
              />
            </Row>
            {mode === 'random' && (
              <>
                <Row label="Surprise" hint="After each gap, the chance per bar that the next silence starts. 100% = right away.">
                  <div class="slider-with-value">
                    <input
                      type="range"
                      class="slider"
                      aria-label="Chance per bar"
                      min={LIMITS.chance.min}
                      max={LIMITS.chance.max}
                      step={1}
                      value={silence.chance}
                      onInput={(e) => update({ chance: Number(e.currentTarget.value) })}
                    />
                    <output>{silence.chance}%</output>
                  </div>
                </Row>
                <Row label="Pattern seed" hint="Optional. Any word or number repeats the exact same pattern. Leave empty for a new one each time.">
                  <input
                    type="text"
                    class="text-input"
                    placeholder="New pattern each time"
                    maxLength={40}
                    value={silence.seed}
                    onInput={(e) => update({ seed: e.currentTarget.value })}
                  />
                </Row>
              </>
            )}
          </>
        )}
      </fieldset>
    </section>
  );
}
