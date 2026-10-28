import { createHash } from 'node:crypto';
import type { DiscountConfig } from './types';

export const HOLDOUT = 'HOLDOUT';
const SCALE = 10_000;

export interface Variant {
  key: string;
  weightBps: number;
  discount: DiscountConfig;
}

export interface ExperimentConfig {
  campaignId: string;
  salt: string;
  /** Share of eligible cards kept without the discount (0–10000 bps). */
  holdoutBps: number;
  /** Empty = no A/B test (everyone treated gets the campaign's own discount, group "A"). */
  variants: Variant[];
}

/** Stable 0–9999 bucket for a card within a campaign; independent across campaigns (salted). */
export function experimentBucket(campaignId: string, salt: string, cardHash: string): number {
  const h = createHash('sha256').update(`${campaignId}:${salt}:${cardHash}`).digest();
  return h.readUInt32BE(0) % SCALE;
}

/**
 * The card's group: HOLDOUT for the first `holdoutBps` of buckets, otherwise a variant chosen by
 * cumulative weight over the remaining buckets. Without variants, treated cards are group "A".
 * The same card always lands in the same group while the configuration is unchanged.
 */
export function assignGroup(exp: ExperimentConfig, cardHash: string): string {
  if (exp.holdoutBps <= 0 && exp.variants.length <= 1) return exp.variants[0]?.key ?? 'A';
  const bucket = experimentBucket(exp.campaignId, exp.salt, cardHash);
  if (bucket < exp.holdoutBps) return HOLDOUT;
  if (exp.variants.length <= 1) return exp.variants[0]?.key ?? 'A';
  // Rescale the treated buckets onto 0–9999 so variant weights apply to treated cards only.
  const position = Math.floor(((bucket - exp.holdoutBps) * SCALE) / (SCALE - exp.holdoutBps));
  let cumulative = 0;
  for (const v of exp.variants) {
    cumulative += v.weightBps;
    if (position < cumulative) return v.key;
  }
  return exp.variants[exp.variants.length - 1]!.key;
}
