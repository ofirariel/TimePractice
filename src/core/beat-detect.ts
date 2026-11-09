/**
 * Beat tracking for a backing track: tempo, beat phase, and an estimated downbeat.
 *
 * Two ways in:
 * - PCM: `analyzeOnsets` / `detectBeatFromPcm` (audio files).
 * - Magnitude frames: `onsetsFromFrames` (e.g. a series of AnalyserNode spectra from
 *   tab-audio or microphone capture). Both produce an `OnsetTrack`, and `detectBeat`
 *   does the rest, so either source shares one detector.
 *
 * Method: a filterbank (or spectral-flux) onset envelope, autocorrelation for the tempo,
 * phase search for the beat grid, then a kick/snare pattern match for the downbeat.
 */

export interface OnsetTrack {
  /** Half-wave onset strength, one value per hop. */
  onset: Float32Array;
  /** Low-frequency onset (kick-like), same hop. */
  kick: Float32Array;
  /** High-mid onset (snare-like), same hop. */
  snare: Float32Array;
  hopSeconds: number;
}

export interface BeatDetection {
  /** Tempo rounded to 0.1 BPM, within 55–215. */
  bpm: number;
  /** Estimated downbeat, in seconds, wrapped into the first bar. */
  offset: number;
  /** Time of one beat on the grid (not necessarily the downbeat). */
  beatTime: number;
  /** 0–1. Low means the tempo was a guess. */
  confidence: number;
}

const ANALYSIS_RATE = 11025;
const HOP = 128;
/** Detection only needs a couple of minutes; the whole file still plays. */
const MAX_ANALYSIS_SECONDS = 120;
const MIN_BPM = 55;
const MAX_BPM = 215;

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

function bandpass(freq: number, sampleRate: number, q: number): Biquad {
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: alpha / a0,
    b1: 0,
    b2: -alpha / a0,
    a1: (-2 * Math.cos(w0)) / a0,
    a2: (1 - alpha) / a0,
    x1: 0,
    x2: 0,
    y1: 0,
    y2: 0,
  };
}

function filterStep(bq: Biquad, x: number): number {
  const y = bq.b0 * x + bq.b1 * bq.x1 + bq.b2 * bq.x2 - bq.a1 * bq.y1 - bq.a2 * bq.y2;
  bq.x2 = bq.x1;
  bq.x1 = x;
  bq.y2 = bq.y1;
  bq.y1 = y;
  return y;
}

function resample(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return samples;
  const count = Math.floor((samples.length * toRate) / fromRate);
  const out = new Float32Array(count);
  const step = fromRate / toRate;
  for (let i = 0; i < count; i++) {
    const x = i * step;
    const j = Math.floor(x);
    const frac = x - j;
    const a = samples[j] ?? 0;
    const b = samples[j + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** Half-wave flux between two magnitude frames (linear or dB). */
export function spectralFlux(prev: ArrayLike<number>, curr: ArrayLike<number>, from = 0, to = curr.length): number {
  let sum = 0;
  const end = Math.min(to, prev.length, curr.length);
  for (let i = from; i < end; i++) {
    const rise = curr[i] - prev[i];
    if (rise > 0) sum += rise;
  }
  return sum;
}

function scaleToPeak(values: Float32Array): Float32Array {
  const sorted = Array.from(values).sort((a, b) => a - b);
  const peak = sorted[Math.floor(sorted.length * 0.95)] || 1;
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = Math.min(4, values[i] / peak);
  return out;
}

/** Onset track from mono PCM. */
export function analyzeOnsets(samples: Float32Array, sampleRate: number): OnsetTrack {
  const limited = samples.length > sampleRate * MAX_ANALYSIS_SECONDS ? samples.subarray(0, Math.floor(sampleRate * MAX_ANALYSIS_SECONDS)) : samples;
  const audio = resample(limited, sampleRate, ANALYSIS_RATE);
  // Seven bands from low kick to snare crack. Q is wide on purpose: real drums aren't tuned.
  const freqs = [70, 140, 280, 560, 1100, 2200, 4000];
  const filters = freqs.map((freq) => bandpass(freq, ANALYSIS_RATE, 1.1));
  const frames = Math.floor(audio.length / HOP);
  const energy = freqs.map(() => new Float32Array(frames));
  for (let frame = 0; frame < frames; frame++) {
    const start = frame * HOP;
    for (let j = 0; j < HOP; j++) {
      const x = audio[start + j];
      for (let b = 0; b < filters.length; b++) {
        const y = filterStep(filters[b], x);
        energy[b][frame] += y * y;
      }
    }
  }
  // Amplitude, not log: a quiet hat must not count as much as a kick, or the tempo
  // locks onto the wrong subdivision.
  const flux = energy.map((band) => {
    const out = new Float32Array(frames);
    for (let i = 1; i < frames; i++) {
      const rise = Math.sqrt(band[i]) - Math.sqrt(band[i - 1]);
      if (rise > 0) out[i] = rise;
    }
    return out;
  });
  const onset = new Float32Array(frames);
  const kick = new Float32Array(frames);
  const snare = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    for (let b = 0; b < flux.length; b++) onset[i] += flux[b][i];
    kick[i] = flux[0][i] + flux[1][i];
    snare[i] = flux[5][i] + flux[6][i];
  }
  return { onset: scaleToPeak(onset), kick: scaleToPeak(kick), snare: scaleToPeak(snare), hopSeconds: HOP / ANALYSIS_RATE };
}

/**
 * Onset track from magnitude frames, such as AnalyserNode spectra captured over time.
 * `binHz` is the frequency width of one bin (sampleRate / fftSize).
 */
export function onsetsFromFrames(frames: readonly ArrayLike<number>[], hopSeconds: number, binHz: number): OnsetTrack {
  const count = frames.length;
  const onset = new Float32Array(count);
  const kick = new Float32Array(count);
  const snare = new Float32Array(count);
  const kickFrom = Math.max(0, Math.floor(50 / binHz));
  const kickTo = Math.max(kickFrom + 1, Math.ceil(160 / binHz));
  const snareFrom = Math.floor(1500 / binHz);
  const snareTo = Math.ceil(4500 / binHz);
  for (let i = 1; i < count; i++) {
    onset[i] = spectralFlux(frames[i - 1], frames[i]);
    kick[i] = spectralFlux(frames[i - 1], frames[i], kickFrom, kickTo);
    snare[i] = spectralFlux(frames[i - 1], frames[i], snareFrom, snareTo);
  }
  return { onset: scaleToPeak(onset), kick: scaleToPeak(kick), snare: scaleToPeak(snare), hopSeconds };
}

function sampleAt(values: Float32Array, frame: number): number {
  const i = Math.floor(frame);
  if (i < 0 || i >= values.length - 1) return values[Math.min(values.length - 1, Math.max(0, i))] ?? 0;
  const frac = frame - i;
  return values[i] * (1 - frac) + values[i + 1] * frac;
}

/** Phase that lands on the strongest onsets. Used once the tempo is already chosen. */
function sharpPhase(onset: Float32Array, periodFrames: number): number {
  const steps = Math.max(24, Math.round(periodFrames * 4));
  let best = -Infinity;
  let phase = 0;
  for (let step = 0; step < steps; step++) {
    const candidate = (step / steps) * periodFrames;
    let sum = 0;
    let count = 0;
    for (let t = candidate; t < onset.length - 1; t += periodFrames) {
      sum += sampleAt(onset, t);
      count++;
    }
    const mean = count > 0 ? sum / count : 0;
    if (mean > best) {
      best = mean;
      phase = candidate;
    }
  }
  return phase;
}

/**
 * Best beat alignment for a period, scored by how much of the onset energy lands
 * close to a beat. A too-slow grid misses the weaker beats, so it scores lower
 * than the true tempo; the mean strength of only the strongest beats does not.
 */
function phaseStrength(onset: Float32Array, periodFrames: number): { strength: number; phase: number } {
  const steps = Math.max(16, Math.round(periodFrames));
  const tolerance = Math.max(1, periodFrames * 0.12);
  let total = 0;
  for (let i = 0; i < onset.length; i++) total += onset[i];
  if (total === 0) return { strength: 0, phase: 0 };
  let bestStrength = -1;
  let bestPhase = 0;
  for (let step = 0; step < steps; step++) {
    const phase = (step / steps) * periodFrames;
    let covered = 0;
    for (let i = 0; i < onset.length; i++) {
      const value = onset[i];
      if (value === 0) continue;
      let distance = (i - phase) % periodFrames;
      if (distance < 0) distance += periodFrames;
      if (distance > periodFrames / 2) distance = periodFrames - distance;
      if (distance <= tolerance) covered += value;
    }
    let beatSum = 0;
    let beatCount = 0;
    for (let t = phase; t < onset.length - 1; t += periodFrames) {
      beatSum += sampleAt(onset, t);
      beatCount++;
    }
    // Recall favours a grid that catches the onsets; precision favours a grid whose
    // beats are actually onsets. The product rejects both half tempo and double tempo.
    const score = (covered / total) * (beatCount > 0 ? beatSum / beatCount : 0);
    if (score > bestStrength) {
      bestStrength = score;
      bestPhase = phase;
    }
  }
  return { strength: bestStrength, phase: bestPhase };
}

/** Tempos suggested by the gaps between the strongest onsets, folded into a comfortable range. */
function intervalTempos(onset: Float32Array, hopSeconds: number): number[] {
  let max = 0;
  for (let i = 0; i < onset.length; i++) if (onset[i] > max) max = onset[i];
  if (max < 0.05) return [];
  const minGap = Math.max(2, Math.round(0.2 / hopSeconds));
  let peaks: number[] = [];
  for (let threshold = max * 0.85; peaks.length < 70 && threshold >= max * 0.2; threshold -= max * 0.1) {
    peaks = [];
    let last = -minGap;
    for (let i = 1; i < onset.length - 1; i++) {
      if (i - last < minGap) continue;
      if (onset[i] >= threshold && onset[i] >= onset[i - 1] && onset[i] > onset[i + 1]) {
        peaks.push(i);
        last = i;
      }
    }
  }
  const votes = new Map<number, number>();
  for (let i = 0; i < peaks.length; i++) {
    const limit = Math.min(peaks.length, i + 8);
    for (let j = i + 1; j < limit; j++) {
      let bpm = 60 / ((peaks[j] - peaks[i]) * hopSeconds);
      if (bpm < 40 || bpm > 320) continue;
      while (bpm < 75) bpm *= 2;
      while (bpm > 160) bpm /= 2;
      const bucket = Math.round(bpm);
      votes.set(bucket, (votes.get(bucket) ?? 0) + onset[peaks[i]]);
    }
  }
  return [...votes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([bpm]) => bpm);
}

interface TempoCandidate {
  bpm: number;
  period: number;
  /** Mean onset strength of the best alignment, before the tempo preference. */
  strength: number;
  score: number;
  phase: number;
}

/** Mild preference for tempos near 120, only used to break near-ties (×2 / ÷2). */
function tempoPrior(bpm: number): number {
  const x = Math.log(bpm / 120);
  return Math.exp(-(x * x) / (2 * 0.5 * 0.5));
}

function findTempo(onset: Float32Array, hopSeconds: number): TempoCandidate | null {
  return collectTempos(onset, hopSeconds)[0] ?? null;
}

function collectTempos(onset: Float32Array, hopSeconds: number): TempoCandidate[] {
  const count = onset.length;
  if (count < 8) return [];
  let mean = 0;
  for (let i = 0; i < count; i++) mean += onset[i];
  mean /= count;
  const centered = new Float32Array(count);
  let energy = 0;
  for (let i = 0; i < count; i++) {
    centered[i] = onset[i] - mean;
    energy += centered[i] * centered[i];
  }
  if (energy < 1e-6) return [];

  const minLag = Math.max(2, Math.floor(60 / MAX_BPM / hopSeconds));
  const maxLag = Math.min(count - 4, Math.ceil(60 / MIN_BPM / hopSeconds));
  if (maxLag <= minLag + 2) return [];
  const correlation = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    const length = count - lag;
    for (let i = 0; i < length; i++) sum += centered[i] * centered[i + lag];
    correlation[lag] = sum / energy;
  }

  const peaks: number[] = [];
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (correlation[lag] >= correlation[lag - 1] && correlation[lag] > correlation[lag + 1] && correlation[lag] > 0.02) peaks.push(lag);
  }
  peaks.sort((a, b) => correlation[b] - correlation[a]);

  // Integer-lag autocorrelation only gets the tempo roughly. Score a fine grid of
  // exact tempos around each peak, so the beat period doesn't drift off the onsets.
  const seen = new Set<number>();
  const candidates: TempoCandidate[] = [];
  const consider = (bpm: number) => {
    if (bpm < MIN_BPM || bpm > MAX_BPM) return;
    const key = Math.round(bpm * 2);
    if (seen.has(key)) return;
    seen.add(key);
    const period = 60 / bpm / hopSeconds;
    const aligned = phaseStrength(onset, period);
    candidates.push({
      bpm,
      period,
      phase: aligned.phase,
      strength: aligned.strength,
      score: aligned.strength * (0.9 + 0.1 * tempoPrior(bpm)),
    });
  };
  const suggested = intervalTempos(onset, hopSeconds);
  if (peaks[0]) suggested.push(60 / (peaks[0] * hopSeconds));
  for (const center of suggested) {
    for (const factor of [1, 0.5, 2]) {
      for (let delta = -1; delta <= 1; delta += 1) consider(center * factor + delta);
    }
  }
  if (candidates.length === 0) consider(120);
  candidates.sort((a, b) => b.score - a.score);
  // When the best tempo is unusually slow or fast, prefer the octave that sits in the
  // range people tap along to, as long as it explains the onsets nearly as well.
  const winner = candidates[0];
  if (winner && (winner.bpm < 80 || winner.bpm > 160)) {
    const alternative = candidates.find((c) => {
      const ratio = c.bpm / winner.bpm;
      const octave = ratio > 0.45 && ratio < 0.55 || ratio > 1.8 && ratio < 2.2;
      return octave && c.bpm >= 80 && c.bpm <= 160 && c.strength > winner.strength * 0.68;
    });
    if (alternative) return [alternative, ...candidates.filter((c) => c !== alternative)];
  }
  return candidates;
}

function windowPeak(values: Float32Array, frame: number, radius: number): number {
  let best = 0;
  const from = Math.max(0, Math.floor(frame - radius));
  const to = Math.min(values.length - 1, Math.ceil(frame + radius));
  for (let i = from; i <= to; i++) best = Math.max(best, values[i]);
  return best;
}

interface BeatWeight {
  kick: number;
  snare: number;
}

/** What each beat of the bar tends to carry, so the downbeat can be told from the backbeat. */
function barPattern(beatsPerBar: number): BeatWeight[] {
  const kick = new Array<number>(beatsPerBar).fill(0);
  const snare = new Array<number>(beatsPerBar).fill(0);
  if (beatsPerBar === 4) {
    kick[0] = 1;
    kick[2] = 0.55;
    snare[1] = 1;
    snare[3] = 0.75;
  } else if (beatsPerBar === 3) {
    kick[0] = 1;
  } else if (beatsPerBar === 6) {
    kick[0] = 1;
    kick[3] = 0.6;
    snare[2] = 1;
    snare[5] = 0.7;
  } else if (beatsPerBar === 2) {
    kick[0] = 1;
    snare[1] = 1;
  } else {
    kick[0] = 1;
  }
  return kick.map((k, i) => ({ kick: k, snare: snare[i] }));
}

/**
 * Downbeat time for a known tempo, wrapped into the first bar.
 * `beatTime` is the time of any beat on the grid.
 */
export function downbeatOffset(track: OnsetTrack, bpm: number, beatTime: number, beatsPerBar: number): number {
  const beats = Math.max(1, Math.round(beatsPerBar));
  const beat = 60 / bpm;
  const bar = beat * beats;
  const pattern = barPattern(beats);
  const radius = Math.max(1, (0.03 / track.hopSeconds));
  // Shift 0 is the beat the tempo tracker found. Only move off it when another beat
  // fits the kick/snare pattern clearly better, so identical beats stay put.
  let bestShift = 0;
  let bestScore = -Infinity;
  for (let shift = 0; shift < beats; shift++) {
    const downbeat = beatTime + shift * beat;
    let score = 0;
    let count = 0;
    const last = track.onset.length * track.hopSeconds;
    for (let t = downbeat; t < last - beat; t += beat) {
      const index = Math.round((t - downbeat) / beat);
      const place = ((index % beats) + beats) % beats;
      const frame = t / track.hopSeconds;
      const weight = pattern[place];
      score += weight.kick * windowPeak(track.kick, frame, radius);
      score += weight.snare * windowPeak(track.snare, frame, radius);
      if (place === 0) score += 0.2 * windowPeak(track.onset, frame, radius);
      count++;
    }
    const mean = count > 0 ? score / count : 0;
    if (mean > bestScore * 1.08) {
      bestScore = mean;
      bestShift = shift;
    }
  }
  const offset = beatTime + bestShift * beat;
  const wrapped = offset % bar;
  return wrapped < 0 ? wrapped + bar : wrapped;
}

/** Tempo, beat grid and estimated downbeat from an onset track. */
export function detectBeat(track: OnsetTrack, beatsPerBar: number): BeatDetection {
  const beats = Math.max(1, Math.round(beatsPerBar)) || 4;
  const fallback: BeatDetection = { bpm: 120, offset: 0, beatTime: 0, confidence: 0 };
  const tempo = findTempo(track.onset, track.hopSeconds);
  if (!tempo) return fallback;
  // Round to the 0.1 BPM the screen shows, then re-align the grid to that exact tempo
  // so the click cannot drift away from the number on screen.
  const bpm = Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(tempo.bpm * 10) / 10));
  const period = 60 / bpm / track.hopSeconds;
  const beatTime = sharpPhase(track.onset, period) * track.hopSeconds;
  const offset = downbeatOffset(track, bpm, beatTime, beats);
  // Confidence comes from how sharp the autocorrelation peak was, via the score gap
  // between this tempo and the un-preferred octave, approximated by the prior-weighted score.
  const confidence = Math.max(0, Math.min(1, tempo.score / 1.5));
  return { bpm, offset, beatTime, confidence };
}

export function detectBeatFromPcm(samples: Float32Array, sampleRate: number, beatsPerBar: number): BeatDetection {
  return detectBeat(analyzeOnsets(samples, sampleRate), beatsPerBar);
}
