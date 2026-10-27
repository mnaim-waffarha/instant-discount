import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  PORT: z.coerce.number().default(3000),
  /** Pepper for hashing acquirer card tokens. Rotating it resets per-card history. */
  CARD_TOKEN_PEPPER: z.string().min(8),
  /** 32-byte key, base64, used to encrypt acquirer HMAC secrets at rest. */
  SECRETS_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64-encoded'),
  RESERVATION_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  SIGNATURE_MAX_SKEW_SECONDS: z.coerce.number().int().positive().default(300),
  CAMPAIGN_CACHE_REFRESH_MS: z.coerce.number().int().positive().default(15_000),
  /** Set to "true" when running behind a load balancer that sets X-Forwarded-For. */
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }
  return parsed.data;
}

export const APP_CONFIG = Symbol('APP_CONFIG');
