import { periodKey, type LimitPeriod } from '@instant-discount/rules-engine';

/** The period buckets a redemption was counted in. Stored on the redemption so release hits the same keys. */
export interface CounterBuckets {
  day: string;
  cardPeriod: string;
}

export function bucketsFor(
  now: Date,
  timezone: string,
  perCardPeriod: LimitPeriod,
): CounterBuckets {
  return {
    day: periodKey('DAY', now, timezone),
    cardPeriod: periodKey(perCardPeriod, now, timezone),
  };
}

/**
 * Redis keys for one campaign. All share the `{c:<id>}` hash tag so a Lua script touching
 * them stays on a single Redis Cluster slot.
 */
export function campaignKeys(campaignId: string) {
  const tag = `{c:${campaignId}}`;
  return {
    tag,
    init: `${tag}:init`,
    rebuildLock: `${tag}:rebuild-lock`,
    spent: `${tag}:spent`,
    count: `${tag}:count`,
    cards: `${tag}:cards`,
    cardRefs: `${tag}:cardrefs`,
    daySpent: (day: string) => `${tag}:d:${day}:spent`,
    dayCount: (day: string) => `${tag}:d:${day}:count`,
    cardCount: (period: string, cardHash: string) => `${tag}:pc:${period}:${cardHash}:count`,
    cardAmount: (period: string, cardHash: string) => `${tag}:pc:${period}:${cardHash}:amount`,
  };
}

/** Ordered KEYS for the reserve/release scripts. */
export function scriptKeys(
  campaignId: string,
  cardHash: string,
  buckets: CounterBuckets,
): string[] {
  const k = campaignKeys(campaignId);
  return [
    k.init,
    k.spent,
    k.count,
    k.cards,
    k.cardRefs,
    k.daySpent(buckets.day),
    k.dayCount(buckets.day),
    k.cardCount(buckets.cardPeriod, cardHash),
    k.cardAmount(buckets.cardPeriod, cardHash),
  ];
}
