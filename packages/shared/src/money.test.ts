import { describe, expect, it } from 'vitest';
import { percentOf, splitByShares, toMajor, toMinor } from './money';

describe('money', () => {
  it('converts major <-> minor', () => {
    expect(toMinor(12.34, 'EGP')).toBe(1234);
    expect(toMajor(1234, 'SAR')).toBe(12.34);
  });

  it('computes percentage in bps rounding down', () => {
    expect(percentOf(10_001, 2_000)).toBe(2_000);
  });

  it('splits by shares keeping the total exact', () => {
    const parts = splitByShares(1_001, [3_334, 3_333, 3_333]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1_001);
    expect(parts).toEqual([335, 333, 333]);
  });
});
