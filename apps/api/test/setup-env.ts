// Defaults for local runs; CI overrides via environment.
process.env.DATABASE_URL ??= 'postgresql://instant@localhost:5432/instant_discount_test';
process.env.REDIS_URL ??= 'redis://localhost:6379/1';
process.env.CARD_TOKEN_PEPPER ??= 'test-pepper-123';
process.env.SECRETS_ENCRYPTION_KEY ??= Buffer.alloc(32, 1).toString('base64');
process.env.CAMPAIGN_CACHE_REFRESH_MS ??= '600000';
