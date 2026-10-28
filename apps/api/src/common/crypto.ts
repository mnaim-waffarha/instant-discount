import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Acquirer request signature:
 *   X-Signature = hex(HMAC-SHA256(secret, `${timestamp}\n${METHOD}\n${path}\n${sha256hex(body)}`))
 * `path` includes the query string, `timestamp` is unix seconds (X-Timestamp).
 */
export function signRequest(
  secret: string,
  timestamp: string,
  method: string,
  path: string,
  body: Buffer | string,
): string {
  const bodyHash = createHash('sha256').update(body).digest('hex');
  return createHmac('sha256', secret)
    .update(`${timestamp}\n${method.toUpperCase()}\n${path}\n${bodyHash}`)
    .digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  return bufA.length === bufB.length && bufA.length > 0 && timingSafeEqual(bufA, bufB);
}

/** We never store acquirer card tokens, only this keyed hash. */
export function hashCardToken(pepper: string, cardToken: string): string {
  return createHmac('sha256', pepper).update(cardToken).digest('hex');
}

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/** AES-256-GCM, serialised as `v1.<iv>.<tag>.<ciphertext>` (base64url parts). */
export function encryptSecret(keyBase64: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyBase64, 'base64'), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), ciphertext]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.');
}

export function decryptSecret(keyBase64: string, encoded: string): string {
  const [version, iv, tag, ciphertext] = encoded.split('.');
  if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('Unsupported secret format');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(keyBase64, 'base64'),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
