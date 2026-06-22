import type { Config } from 'drizzle-kit';

export default {
  schema: './libs/database/src/schema/index.ts',
  out: './docker/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://rag:rag@localhost:5433/rag',
  },
} satisfies Config;
