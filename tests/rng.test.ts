import { describe, expect, it } from 'vitest';
import { createRng, hashSeed, randFloat, randInt } from '../src/core/rng';

describe('rng', () => {
  it('is repeatable for the same seed', () => {
    const a = createRng('groove');
    const b = createRng('groove');
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('differs between seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    const same = Array.from({ length: 20 }, () => a() === b()).every(Boolean);
    expect(same).toBe(false);
  });

  it('treats numeric and string seeds consistently', () => {
    expect(hashSeed('abc')).toBe(hashSeed('abc'));
    expect(hashSeed('abc')).not.toBe(hashSeed('abd'));
  });

  it('returns floats in [0, 1)', () => {
    const r = createRng(42);
    for (let i = 0; i < 10000; i++) {
      const x = r();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('randInt covers the whole inclusive range and nothing else', () => {
    const r = createRng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(randInt(r, 2, 5));
    expect([...seen].sort()).toEqual([2, 3, 4, 5]);
  });

  it('randFloat stays within range even when min > max', () => {
    const r = createRng(9);
    for (let i = 0; i < 1000; i++) {
      const x = randFloat(r, 5, 2);
      expect(x).toBeGreaterThanOrEqual(2);
      expect(x).toBeLessThan(5);
    }
  });
});
