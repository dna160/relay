/**
 * The migration runner invoked by `npm run db:migrate`.
 *
 * Migrations are forward-only and are never edited after they are written
 * (CLAUDE.md). Drizzle records what it has applied in `drizzle.__migrations`,
 * so a rerun on an up-to-date database is a no-op — which is the property the
 * Phase 1 exit condition checks.
 */

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_FOLDER = fileURLToPath(new URL('./migrations', import.meta.url));

export async function runMigrations(connectionString: string): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}

const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  runMigrations(url).then(
    () => {
      console.log('migrations applied');
      process.exit(0);
    },
    (error: unknown) => {
      console.error(error);
      process.exit(1);
    },
  );
}
