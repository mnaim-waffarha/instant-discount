import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ErrorFilter } from './common/error.filter';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { loadConfig } from './config';

// Money is stored as BigInt minor units; all values fit safely in a JS number.
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function (this: bigint) {
  return Number(this);
};

/** Shared by main.ts and tests so both run the same HTTP setup. */
export function configureApp(app: INestApplication) {
  const config = loadConfig();
  const express = app as NestExpressApplication;
  if (config.TRUST_PROXY) express.set('trust proxy', true);
  // Admin CSV imports need more room than acquirer calls.
  express.useBodyParser('json', { limit: '2mb' });
  express.use(cookieParser());
  // Correlate logs across the acquirer, the API and support tickets.
  express.use(
    (
      req: { headers: Record<string, unknown> },
      res: { setHeader: (k: string, v: string) => void },
      next: () => void,
    ) => {
      const incoming = req.headers['x-request-id'];
      const id =
        typeof incoming === 'string' && /^[\w-]{1,64}$/.test(incoming) ? incoming : randomUUID();
      req.headers['x-request-id'] = id;
      res.setHeader('X-Request-Id', id);
      next();
    },
  );
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
  return app;
}
