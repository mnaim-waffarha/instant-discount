import { describe, expect, it } from 'vitest';
import { compare, normalCdf } from './stats';

describe('stats', () => {
  it('normal CDF matches tables', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 6);
    expect(normalCdf(-1.644854)).toBeCloseTo(0.05, 6);
    expect(normalCdf(3)).toBeCloseTo(0.99865, 5);
  });

  it('Welch comparison: difference, CI and p-value', () => {
    // se = sqrt(400/100 + 400/100) = 2.8284; z = 10 / 2.8284 = 3.5355
    const r = compare({ n: 100, mean: 110, variance: 400 }, { n: 100, mean: 100, variance: 400 })!;
    expect(r.diff).toBe(10);
    expect(r.se).toBeCloseTo(2.8284, 4);
    expect(r.z).toBeCloseTo(3.5355, 4);
    expect(r.pValue).toBeCloseTo(0.000407, 5);
    expect(r.ci95[0]).toBeCloseTo(4.4564, 3);
    expect(r.ci95[1]).toBeCloseTo(15.5436, 3);
    expect(r.relative).toBeCloseTo(0.1, 10);
    expect(r.significant).toBe(true);
  });

  it('is not significant when the interval crosses zero', () => {
    const r = compare({ n: 50, mean: 101, variance: 900 }, { n: 50, mean: 100, variance: 900 })!;
    expect(r.ci95[0]).toBeLessThan(0);
    expect(r.ci95[1]).toBeGreaterThan(0);
    expect(r.significant).toBe(false);
  });

  it('needs at least two cards per group', () => {
    expect(compare({ n: 1, mean: 5, variance: 0 }, { n: 10, mean: 4, variance: 1 })).toBeNull();
  });
});
