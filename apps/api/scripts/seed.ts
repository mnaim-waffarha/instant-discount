import { PrismaClient } from '@instant-discount/db';
import { loadConfig } from '../src/config';
import { DEMO, createDemoCampaign, createDemoNetwork } from './demo-data';

async function main() {
  const config = loadConfig();
  const prisma = new PrismaClient();
  if (!(await prisma.acquirer.findUnique({ where: { apiKeyId: DEMO.apiKeyId } }))) {
    const net = await createDemoNetwork(prisma, config.SECRETS_ENCRYPTION_KEY);
    const campaign = await createDemoCampaign(prisma, net);
    console.log(
      `Seeded acquirer ${DEMO.apiKeyId} / terminal ${DEMO.terminalId} / campaign ${campaign.id}`,
    );
  }

  // Demo users for local development (sign in with DEV_LOGIN).
  const bank = await prisma.partner.findFirst({ where: { name: 'Demo Bank' } });
  const users = [
    { email: 'admin@waffarha.com', name: 'Amira Admin', role: 'ADMIN' as const },
    { email: 'manager@waffarha.com', name: 'Mona Manager', role: 'CAMPAIGN_MANAGER' as const },
    { email: 'approver@waffarha.com', name: 'Adel Approver', role: 'APPROVER' as const },
    { email: 'finance@waffarha.com', name: 'Farah Finance', role: 'FINANCE' as const },
    ...(bank
      ? [
          {
            email: 'ops@demobank.example',
            name: 'Demo Bank Ops',
            role: 'PARTNER_USER' as const,
            partnerId: bank.id,
          },
        ]
      : []),
  ];
  for (const u of users)
    await prisma.user.upsert({ where: { email: u.email }, update: {}, create: u });
  console.log(`Demo users: ${users.map((u) => u.email).join(', ')}`);
  await prisma.$disconnect();
}

void main();
