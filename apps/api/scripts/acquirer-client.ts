import { signRequest } from '../src/common/crypto';
import { DEMO } from './demo-data';

/** Minimal signed client, the way an acquirer would call us. */
export function acquirerClient(baseUrl = process.env.API_URL ?? 'http://localhost:3000') {
  const apiKey = process.env.ACQUIRER_API_KEY ?? DEMO.apiKeyId;
  const secret = process.env.ACQUIRER_SECRET ?? DEMO.hmacSecret;

  return async function post<T = Record<string, unknown>>(
    path: string,
    body: unknown,
    idempotencyKey?: string,
  ): Promise<{ status: number; body: T; ms: number }> {
    const raw = JSON.stringify(body);
    const ts = String(Math.floor(Date.now() / 1000));
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
      'X-Timestamp': ts,
      'X-Signature': signRequest(secret, ts, 'POST', path, raw),
    };
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const started = performance.now();
    const res = await fetch(baseUrl + path, { method: 'POST', headers, body: raw });
    return { status: res.status, body: (await res.json()) as T, ms: performance.now() - started };
  };
}
