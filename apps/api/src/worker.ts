import 'reflect-metadata';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadConfig } from './config';
import { WorkerModule } from './worker.module';

/** Background worker: same codebase as the API, no HTTP server. */
async function main() {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: new ConsoleLogger({ json: loadConfig().LOG_FORMAT === 'json' }),
  });
  app.enableShutdownHooks();
}

void main();
