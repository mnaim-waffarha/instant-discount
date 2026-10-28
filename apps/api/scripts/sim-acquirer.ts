/**
 * Simulates one card payment end to end: inquire → (charge) → confirm, optionally refund.
 *   pnpm sim -- --amount 50000 --card tok_123 --refund 10000
 */
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { acquirerClient } from './acquirer-client';
import { DEMO } from './demo-data';

const { values } = parseArgs({
  options: {
    amount: { type: 'string', default: '50000' },
    card: { type: 'string', default: `tok_${randomUUID()}` },
    bin: { type: 'string', default: DEMO.bin },
    terminal: { type: 'string', default: DEMO.terminalId },
    refund: { type: 'string' },
    decline: { type: 'boolean', default: false },
  },
});

async function main() {
  const post = acquirerClient();
  const txn = `sim-${Date.now()}`;
  const inquiry = await post<Record<string, unknown>>(
    '/v1/discounts/inquire',
    {
      terminal_id: values.terminal,
      bin: values.bin,
      card_token: values.card,
      scheme: 'VISA',
      amount: Number(values.amount),
      currency: 'EGP',
      acquirer_txn_ref: txn,
    },
    txn,
  );
  console.log(`inquire (${inquiry.ms.toFixed(0)} ms)`, inquiry.status, inquiry.body);
  if (!inquiry.body.eligible) return console.log('→ no discount, charge full amount');

  const id = inquiry.body.redemption_id as string;
  if (values.decline) {
    const cancel = await post(`/v1/discounts/${id}/cancel`, { reason: 'declined' });
    return console.log('cancel', cancel.status, cancel.body);
  }
  const confirm = await post(`/v1/discounts/${id}/confirm`, {
    charged_amount: inquiry.body.final_amount,
    auth_code: 'SIM01',
  });
  console.log('confirm', confirm.status, confirm.body);

  if (values.refund) {
    const refund = await post(`/v1/discounts/${id}/refund`, {
      refund_id: `rf-${txn}`,
      amount: Number(values.refund),
    });
    console.log('refund', refund.status, refund.body);
  }
}

void main();
