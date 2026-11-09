export type ClickSound = 'classic' | 'woodblock' | 'cowbell' | 'beep';
export type BeatLevel = 'accent' | 'normal' | 'soft' | 'off';
export type AudibleLevel = Exclude<BeatLevel, 'off'>;

export const CLICK_SOUNDS: { value: ClickSound; label: string }[] = [
  { value: 'classic', label: 'Classic' },
  { value: 'woodblock', label: 'Woodblock' },
  { value: 'cowbell', label: 'Cowbell' },
  { value: 'beep', label: 'Soft beep' },
];

/** Longest click; must stay shorter than one beat at the fastest tempo (400 BPM = 150 ms). */
export const MAX_CLICK_SECONDS = 0.12;
const SOFT_GAIN = 0.4;
const TAIL_FADE_SECONDS = 0.002;

interface Voice {
  seconds: number;
  /** One sample at time t (seconds) for a given pitch multiplier. */
  sample: (t: number, pitch: number) => number;
}

const TAU = 2 * Math.PI;
const sine = (f: number, t: number) => Math.sin(TAU * f * t);
const attack = (t: number, seconds: number) => Math.min(1, t / seconds);

const VOICES: Record<ClickSound, Voice> = {
  // The original milestone-1 blip.
  classic: {
    seconds: 0.06,
    sample: (t, p) => attack(t, 0.0005) * Math.exp(-t / 0.009) * sine(1175 * p, t),
  },
  // Hollow knock: a low body plus a short, inharmonic overtone.
  woodblock: {
    seconds: 0.07,
    sample: (t, p) =>
      attack(t, 0.0003) * (0.75 * Math.exp(-t / 0.014) * sine(820 * p, t) + 0.35 * Math.exp(-t / 0.004) * sine(2240 * p, t)),
  },
  // Two detuned square-ish tones, the classic drum-machine cowbell.
  cowbell: {
    seconds: 0.12,
    sample: (t, p) => {
      const sq = (f: number) => sine(f, t) + sine(3 * f, t) / 3 + sine(5 * f, t) / 5;
      return attack(t, 0.0005) * Math.exp(-t / 0.035) * 0.45 * (sq(560 * p) + sq(845 * p));
    },
  },
  // Gentle sine with a rounded attack.
  beep: {
    seconds: 0.09,
    sample: (t, p) => attack(t, 0.004) * Math.exp(-t / 0.03) * sine(880 * p, t),
  },
};

const ACCENT_PITCH = 1.5;
const LEVEL_GAIN: Record<AudibleLevel, number> = { accent: 0.9, normal: 0.6, soft: 0.6 * SOFT_GAIN };

/** Renders one click as raw samples. Pure maths, so it can be tested without a browser. */
export function renderClickSamples(sound: ClickSound, level: AudibleLevel, sampleRate: number): Float32Array<ArrayBuffer> {
  const voice = VOICES[sound];
  const pitch = level === 'accent' ? ACCENT_PITCH : 1;
  const length = Math.floor(voice.seconds * sampleRate);
  const fadeSamples = TAIL_FADE_SECONDS * sampleRate;
  const out = new Float32Array(length);
  let peak = 0;
  for (let i = 0; i < length; i++) {
    out[i] = voice.sample(i / sampleRate, pitch) * Math.min(1, (length - 1 - i) / fadeSamples);
    peak = Math.max(peak, Math.abs(out[i]));
  }
  // Normalise so every sound has the same loudness at the same level.
  const scale = peak > 0 ? LEVEL_GAIN[level] / peak : 0;
  for (let i = 0; i < length; i++) out[i] *= scale;
  return out;
}

export const BEAT_LEVEL_ORDER: BeatLevel[] = ['accent', 'normal', 'soft', 'off'];

/** Next level when a beat is tapped: accent → normal → soft → off → accent. */
export function nextBeatLevel(level: BeatLevel): BeatLevel {
  return BEAT_LEVEL_ORDER[(BEAT_LEVEL_ORDER.indexOf(level) + 1) % BEAT_LEVEL_ORDER.length];
}
