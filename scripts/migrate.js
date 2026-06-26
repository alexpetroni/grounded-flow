'use strict';
// Runs Drizzle migrations — executed by the one-shot `migrate` container.
// Plain CJS so it runs without a build step.
const { drizzle } = require('drizzle-orm/node-postgres');
const { migrate } = require('drizzle-orm/node-postgres/migrator');
const { Pool } = require('pg');
const path = require('path');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const migrationsFolder = path.resolve(__dirname, '../docker/migrations');

// Postgres can report healthy a beat before it accepts TCP connections, so a
// freshly-started stack may briefly ECONNREFUSED. Retry with backoff rather
// than fail the one-shot migrate container on a transient race.
const MAX_ATTEMPTS = Number(process.env.MIGRATE_MAX_ATTEMPTS || 10);
const RETRY_DELAY_MS = Number(process.env.MIGRATE_RETRY_DELAY_MS || 2000);
const TRANSIENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isTransient(err) {
  const code = err && (err.code || (err.cause && err.cause.code));
  return code ? TRANSIENT.has(code) : false;
}

async function run() {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const pool = new Pool({ connectionString: url });
    try {
      await migrate(drizzle(pool), { migrationsFolder });
      await pool.end();
      console.log('Migrations applied successfully');
      return;
    } catch (err) {
      await pool.end().catch(() => {});
      if (attempt < MAX_ATTEMPTS && isTransient(err)) {
        console.warn(
          `Migration attempt ${attempt}/${MAX_ATTEMPTS} failed (${err.code || err.cause?.code}); retrying in ${RETRY_DELAY_MS}ms`,
        );
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      throw err;
    }
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
