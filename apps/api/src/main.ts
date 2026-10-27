import 'reflect-metadata';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { loadConfig } from './config';

async function main() {
  // rawBody is required to verify request signatures.
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    logger: new ConsoleLogger({ json: config.LOG_FORMAT === 'json' }),
  });
  configureApp(app);
  await app.listen(config.PORT);
}

void main();
