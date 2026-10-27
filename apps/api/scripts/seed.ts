import { PrismaClient } from '@instant-discount/db';
import { loadConfig } from '../src/config';
import { DEMO, createDemoCampaign, createDemoNetwork } from './demo-data';

async function main() {
  const config = loadConfig();
  const prisma = new PrismaClient();
  if (await prisma.acquirer.findUnique({ where: { apiKeyId: DEMO.apiKeyId } })) {
    console.log('Demo data already present, nothing to do.');
    return prisma.$disconnect();
  }
  const net = await createDemoNetwork(prisma, config.SECRETS_ENCRYPTION_KEY);
  const campaign = await createDemoCampaign(prisma, net);
  console.log(
    `Seeded acquirer ${DEMO.apiKeyId} / terminal ${DEMO.terminalId} / campaign ${campaign.id}`,
  );
  await prisma.$disconnect();
}

void main();
