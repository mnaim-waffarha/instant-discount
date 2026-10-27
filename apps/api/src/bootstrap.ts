import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ErrorFilter } from './common/error.filter';
import { loadConfig } from './config';

/** Shared by main.ts and tests so both run the same HTTP setup. */
export function configureApp(app: INestApplication) {
  const config = loadConfig();
  const express = app as NestExpressApplication;
  if (config.TRUST_PROXY) express.set('trust proxy', true);
  express.useBodyParser('json', { limit: '16kb' });
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
  return app;
}
