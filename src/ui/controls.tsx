import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function roundTo(n: number, step: number) {
  const decimals = (String(step).split('.')[1] ?? '').length;
  return Number((Math.round(n / step) * step).toFixed(decimals));
}

interface NumberFieldProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  label: string;
  suffix?: string;
  disabled?: boolean;
}

/** A number box with big − / + buttons. Typing is free-form and only committed when valid. */
export function NumberField({ value, onChange, min, max, step, label, suffix, disabled }: NumberFieldProps) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    if (Number(text) !== value) setText(String(value));
    // Only react to outside changes of `value`, not to typing.
  }, [value]);

  const commit = (n: number) => {
    const next = clamp(roundTo(n, step), min, max);
    setText(String(next));
    if (next !== value) onChange(next);
  };

  return (
    <div class="number-field">
      <button type="button" class="step" aria-label={`Decrease ${label}`} disabled={disabled || value <= min} onClick={() => commit(value - step)}>
        −
      </button>
      <label class="number-box">
        <input
          type="text"
          inputMode="decimal"
          aria-label={label}
          value={text}
          disabled={disabled}
          onInput={(e) => {
            const raw = e.currentTarget.value;
            setText(raw);
            const n = Number(raw);
            if (raw.trim() !== '' && Number.isFinite(n) && n >= min && n <= max) onChange(roundTo(n, step));
          }}
          onBlur={() => {
            const n = Number(text);
            commit(text.trim() !== '' && Number.isFinite(n) ? n : value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        {suffix && <span class="suffix">{suffix}</span>}
      </label>
      <button type="button" class="step" aria-label={`Increase ${label}`} disabled={disabled || value >= max} onClick={() => commit(value + step)}>
        +
      </button>
    </div>
  );
}

interface SegmentedProps<T extends string> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
  disabled?: boolean;
}

export function Segmented<T extends string>({ value, options, onChange, label, disabled }: SegmentedProps<T>) {
  return (
    <div class="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          type="button"
          role="radio"
          aria-checked={o.value === value}
          class={o.value === value ? 'active' : ''}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <label class="toggle">
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.currentTarget.checked)} />
      <span class="track" aria-hidden="true">
        <span class="thumb" />
      </span>
    </label>
  );
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: ComponentChildren }) {
  return (
    <div class="row">
      <div class="row-label">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div class="row-control">{children}</div>
    </div>
  );
}
