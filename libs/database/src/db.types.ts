import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from './schema/index';

export type Db = NodePgDatabase<typeof schema>;
