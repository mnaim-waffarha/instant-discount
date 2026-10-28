/**
 * Fires N inquiries with C in flight and reports latency percentiles and how many were granted.
 *   pnpm load -- --requests 2000 --concurrency 50
 */
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { acquirerClient } from './acquirer-client';
import { DEMO } from './demo-data';

const { values } = parseArgs({
  options: {
    requests: { type: 'string', default: '1000' },
    concurrency: { type: 'string', default: '50' },
    amount: { type: 'string', default: '50000' },
  },
});

async function main() {
  const post = acquirerClient();
  const total = Number(values.requests);
  const latencies: number[] = [];
  const outcomes = new Map<string, number>();
  let next = 0;

  async function workerLoop() {
    while (next < total) {
      next++;
      const id = randomUUID();
      const res = await post<{ eligible: boolean; reason?: string }>(
        '/v1/discounts/inquire',
        {
          terminal_id: DEMO.terminalId,
          bin: DEMO.bin,
          card_token: `tok_${id}`,
          scheme: 'VISA',
          amount: Number(values.amount),
          currency: 'EGP',
          acquirer_txn_ref: id,
        },
        id,
      );
      latencies.push(res.ms);
      const key =
        res.status !== 200
          ? `HTTP_${res.status}`
          : res.body.eligible
            ? 'GRANTED'
            : res.body.reason!;
      outcomes.set(key, (outcomes.get(key) ?? 0) + 1);
    }
  }

  const started = performance.now();
  await Promise.all(Array.from({ length: Number(values.concurrency) }, workerLoop));
  const seconds = (performance.now() - started) / 1000;
  latencies.sort((a, b) => a - b);
  const pct = (p: number) =>
    latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))]!.toFixed(1);

  console.log(
    `${total} requests in ${seconds.toFixed(1)}s (${(total / seconds).toFixed(0)} req/s)`,
  );
  console.log(`latency ms  p50=${pct(50)}  p95=${pct(95)}  p99=${pct(99)}  max=${pct(100)}`);
  console.log('outcomes', Object.fromEntries(outcomes));
}

void main();
