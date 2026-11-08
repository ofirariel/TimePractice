/** A deterministic random source returning floats in [0, 1). */
export type Rng = () => number;

/** Hashes any text (e.g. a user-typed seed) to a 32-bit unsigned integer (FNV-1a). */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32: tiny, fast, good enough for musical randomness, and fully repeatable. */
export function createRng(seed: number | string): Rng {
  let a = (typeof seed === 'string' ? hashSeed(seed) : seed) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform integer in [min, max], both inclusive. */
export function randInt(rng: Rng, min: number, max: number): number {
  const lo = Math.ceil(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/** Uniform float in [min, max). */
export function randFloat(rng: Rng, min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + rng() * (hi - lo);
}

/** A short, human-friendly seed for sessions where the user didn't pick one. */
export function makeSeed(): string {
  return String(Math.floor(Math.random() * 900000) + 100000);
}
