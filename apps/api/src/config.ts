import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  PORT: z.coerce.number().default(3000),
  /** Health and metrics port of the background worker. */
  WORKER_PORT: z.coerce.number().default(3010),
  /** Pepper for hashing acquirer card tokens. Rotating it resets per-card history. */
  CARD_TOKEN_PEPPER: z.string().min(8),
  /** 32-byte key, base64, used to encrypt acquirer HMAC secrets at rest. */
  SECRETS_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64-encoded'),
  RESERVATION_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  SIGNATURE_MAX_SKEW_SECONDS: z.coerce.number().int().positive().default(300),
  CAMPAIGN_CACHE_REFRESH_MS: z.coerce.number().int().positive().default(15_000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Public URL of the web app, used in magic-link emails. */
  WEB_BASE_URL: z.string().url().default('http://localhost:3001'),
  /** Google OAuth client id for staff SSO (ID tokens are verified against it). */
  GOOGLE_CLIENT_ID: z.string().optional(),
  /** Only Google accounts of this Workspace domain may sign in as staff. */
  GOOGLE_HOSTED_DOMAIN: z.string().default('waffarha.com'),
  /** Comma-separated emails created as ADMIN on startup if missing. */
  BOOTSTRAP_ADMIN_EMAILS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
  /** Enables POST /admin/v1/auth/dev-login. Refused when NODE_ENV=production. */
  DEV_LOGIN: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** e.g. smtp://user:pass@smtp.example.com:587. Unset = emails are logged, not sent. */
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('Waffarha Instant Discount <no-reply@waffarha.com>'),
  /** Slack incoming webhook for alerts. Unset = alerts are only stored and logged. */
  SLACK_WEBHOOK_URL: z.string().url().optional(),
  /** If set, GET /metrics requires `Authorization: Bearer <token>`. */
  METRICS_TOKEN: z.string().optional(),
  /** "json" for structured logs (production), "text" for local development. */
  LOG_FORMAT: z.enum(['json', 'text']).default('text'),
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
  if (parsed.data.DEV_LOGIN && parsed.data.NODE_ENV === 'production') {
    throw new Error('DEV_LOGIN must not be enabled in production');
  }
  return parsed.data;
}

export const APP_CONFIG = Symbol('APP_CONFIG');
