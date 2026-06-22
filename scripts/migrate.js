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

const pool = new Pool({ connectionString: url });
const db = drizzle(pool);

const migrationsFolder = path.resolve(__dirname, '../docker/migrations');

migrate(db, { migrationsFolder })
  .then(async () => {
    await pool.end();
    console.log('Migrations applied successfully');
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Migration failed:', err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
