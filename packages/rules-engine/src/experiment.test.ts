import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HOLDOUT, assignGroup, experimentBucket, type ExperimentConfig } from './experiment';

const fixed = { type: 'FIXED', amountMinor: 1_000 } as const;
const cards = Array.from({ length: 100_000 }, () => randomUUID());

function shares(exp: ExperimentConfig) {
  const counts = new Map<string, number>();
  for (const c of cards) {
    const g = assignGroup(exp, c);
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].map(([k, v]) => [k, v / cards.length]));
}

describe('experiment assignment', () => {
  it('without holdout or variants everyone is treated, with no hashing needed', () => {
    expect(assignGroup({ campaignId: 'c', salt: 's', holdoutBps: 0, variants: [] }, 'card')).toBe(
      'A',
    );
  });

  it('holds out the configured share of cards', () => {
    const s = shares({ campaignId: 'c1', salt: 's1', holdoutBps: 1_000, variants: [] });
    expect(s[HOLDOUT]).toBeGreaterThan(0.095);
    expect(s[HOLDOUT]).toBeLessThan(0.105);
    expect(s.A).toBeCloseTo(1 - s[HOLDOUT]!, 10);
  });

  it('splits treated cards by variant weight', () => {
    const s = shares({
      campaignId: 'c2',
      salt: 's2',
      holdoutBps: 2_000,
      variants: [
        { key: 'A', weightBps: 5_000, discount: fixed },
        { key: 'B', weightBps: 3_000, discount: fixed },
        { key: 'C', weightBps: 2_000, discount: fixed },
      ],
    });
    // 20% holdout, then 50/30/20 of the remaining 80%.
    expect(s[HOLDOUT]).toBeCloseTo(0.2, 1);
    expect(s.A).toBeGreaterThan(0.39);
    expect(s.A).toBeLessThan(0.41);
    expect(s.B).toBeGreaterThan(0.23);
    expect(s.B).toBeLessThan(0.25);
    expect(s.C).toBeGreaterThan(0.15);
    expect(s.C).toBeLessThan(0.17);
  });

  it('is stable per card and independent across campaigns', () => {
    const exp = { campaignId: 'c3', salt: 's3', holdoutBps: 5_000, variants: [] };
    for (const c of cards.slice(0, 100)) expect(assignGroup(exp, c)).toBe(assignGroup(exp, c));
    // Being held out of one campaign says nothing about another.
    const other = { campaignId: 'c4', salt: 's4', holdoutBps: 5_000, variants: [] };
    const both = cards.filter(
      (c) => assignGroup(exp, c) === HOLDOUT && assignGroup(other, c) === HOLDOUT,
    ).length;
    expect(both / cards.length).toBeGreaterThan(0.24);
    expect(both / cards.length).toBeLessThan(0.26);
  });

  it('buckets stay in range', () => {
    for (const c of cards.slice(0, 1000)) {
      const b = experimentBucket('c', 's', c);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(10_000);
    }
  });
});
