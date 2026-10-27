import type { Prisma, PrismaClient } from '@instant-discount/db';
import { encryptSecret } from '../src/common/crypto';

export const DEMO = {
  apiKeyId: 'acq_demo',
  hmacSecret: 'demo-secret-change-me',
  terminalId: 'TID0001',
  bin: '412345',
} as const;

/** Partners, a merchant with one branch and terminal, and an acquirer. Returns their ids. */
export async function createDemoNetwork(prisma: PrismaClient, secretsKey: string) {
  const bank = await prisma.partner.create({
    data: { name: 'Demo Bank', type: 'BANK', country: 'EG' },
  });
  const waffarha = await prisma.partner.create({
    data: { name: 'Waffarha', type: 'WAFFARHA', country: 'EG' },
  });
  const merchantPartner = await prisma.partner.create({
    data: { name: 'Demo Cafe Co.', type: 'MERCHANT', country: 'EG' },
  });
  const merchant = await prisma.merchant.create({
    data: { partnerId: merchantPartner.id, name: 'Demo Cafe', country: 'EG', mcc: '5812' },
  });
  const branch = await prisma.branch.create({
    data: { merchantId: merchant.id, name: 'Zamalek', city: 'Cairo' },
  });
  const acquirer = await prisma.acquirer.create({
    data: {
      name: 'Demo Acquirer',
      country: 'EG',
      apiKeyId: DEMO.apiKeyId,
      hmacSecretEnc: encryptSecret(secretsKey, DEMO.hmacSecret),
    },
  });
  const terminal = await prisma.terminal.create({
    data: {
      acquirerId: acquirer.id,
      externalTerminalId: DEMO.terminalId,
      merchantId: merchant.id,
      branchId: branch.id,
    },
  });
  return { bank, waffarha, merchantPartner, merchant, branch, acquirer, terminal };
}

export type DemoNetwork = Awaited<ReturnType<typeof createDemoNetwork>>;

/**
 * "20% off up to 150 EGP, min spend 200 EGP" co-funded 50% bank / 30% merchant / 20% Waffarha.
 * Amounts are in piastres.
 */
export async function createDemoCampaign(
  prisma: PrismaClient,
  net: DemoNetwork,
  overrides: Partial<Prisma.CampaignUncheckedCreateInput> = {},
) {
  const now = Date.now();
  return prisma.campaign.create({
    data: {
      name: 'Demo Bank 20% at Demo Cafe',
      status: 'ACTIVE',
      priority: 10,
      country: 'EG',
      currency: 'EGP',
      timezone: 'Africa/Cairo',
      startAt: new Date(now - 86_400_000),
      endAt: new Date(now + 30 * 86_400_000),
      discountType: 'PERCENT',
      discountConfig: {
        type: 'PERCENT',
        percentBps: 2_000,
        maxDiscountMinor: 15_000,
        minSpendMinor: 20_000,
      },
      targeting: { binRanges: [{ from: DEMO.bin, to: DEMO.bin }], merchantIds: [net.merchant.id] },
      displayMessage: 'You saved with Demo Bank!',
      displayMessageAr: 'وفرت مع بنك ديمو!',
      totalBudgetMinor: 10_000_000n,
      maxUniqueCards: 1_000,
      perCardMaxCount: 2,
      perCardPeriod: 'CAMPAIGN',
      ...overrides,
      fundings: {
        create: [
          { partnerId: net.bank.id, shareBps: 5_000 },
          { partnerId: net.merchantPartner.id, shareBps: 3_000 },
          { partnerId: net.waffarha.id, shareBps: 2_000 },
        ],
      },
    },
  });
}
