import { execSync } from 'node:child_process';
import path from 'node:path';

/** Applies migrations to the test database once per run. */
export default function setup() {
  const url =
    process.env.DATABASE_URL ?? 'postgresql://instant@localhost:5432/instant_discount_test';
  const dbDir = path.resolve(__dirname, '../../../packages/db');
  execSync('npx prisma migrate reset --force --skip-seed --skip-generate', {
    cwd: dbDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'ignore',
  });
}
