import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ErrorFilter } from './common/error.filter';
import cookieParser from 'cookie-parser';
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
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
  return app;
}
