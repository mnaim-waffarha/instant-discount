import { computeDiscount } from './discount';
import { checkTargeting } from './targeting';
import { isWithinSchedule } from './time';
import type { CampaignRule, Evaluation, TransactionContext } from './types';

export function evaluateCampaign(
  campaign: CampaignRule,
  txn: TransactionContext,
  now: Date,
): Evaluation {
  const reject = (reason: Extract<Evaluation, { eligible: false }>['reason']): Evaluation => ({
    eligible: false,
    campaignId: campaign.id,
    reason,
  });

  if (campaign.status !== 'ACTIVE') return reject('NOT_ACTIVE');
  if (now < campaign.startAt || now >= campaign.endAt) return reject('OUTSIDE_DATES');
  if (campaign.country !== txn.country) return reject('COUNTRY_MISMATCH');
  if (campaign.currency !== txn.currency) return reject('CURRENCY_MISMATCH');
  if (!isWithinSchedule(campaign.schedule, now, campaign.timezone))
    return reject('OUTSIDE_SCHEDULE');

  const targetingFailure = checkTargeting(campaign.targeting, txn);
  if (targetingFailure) return reject(targetingFailure);

  const result = computeDiscount(campaign.discount, txn.amountMinor);
  if (!result.ok) return reject(result.reason);
  if (result.discountMinor === 0) return reject('ZERO_DISCOUNT');

  return {
    eligible: true,
    campaignId: campaign.id,
    discountMinor: result.discountMinor,
    finalAmountMinor: txn.amountMinor - result.discountMinor,
  };
}

export interface RankedCandidates {
  /** Ordered best-first. The decision service tries to reserve caps in this order. */
  eligible: Array<Extract<Evaluation, { eligible: true }> & { campaign: CampaignRule }>;
  rejected: Array<Extract<Evaluation, { eligible: false }>>;
}

/**
 * Evaluates all campaigns and orders the eligible ones by priority (highest first).
 * Ties are broken by larger discount, then by campaign id for determinism.
 */
export function rankCampaigns(
  campaigns: CampaignRule[],
  txn: TransactionContext,
  now: Date,
): RankedCandidates {
  const out: RankedCandidates = { eligible: [], rejected: [] };
  for (const campaign of campaigns) {
    const evaluation = evaluateCampaign(campaign, txn, now);
    if (evaluation.eligible) out.eligible.push({ ...evaluation, campaign });
    else out.rejected.push(evaluation);
  }
  out.eligible.sort(
    (a, b) =>
      b.campaign.priority - a.campaign.priority ||
      b.discountMinor - a.discountMinor ||
      a.campaignId.localeCompare(b.campaignId),
  );
  return out;
}
