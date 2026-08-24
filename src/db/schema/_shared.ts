/**
 * Column primitives shared by every table.
 *
 * DATA-MODEL.md: all ids are uuid v7, all timestamps are `timestamptz`, and
 * email columns are `citext` so that `Ana@Studio.com` and `ana@studio.com` are
 * one contact rather than two audit trails.
 */

import { customType, timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';

/**
 * Postgres `citext`. The extension is created by the first migration.
 * Case-insensitive equality is a database property here, not a call-site
 * discipline — a `lower()` someone forgets is how a duplicate contact appears.
 */
export const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'citext';
  },
});

/** uuid v7: time-ordered, so primary-key inserts stay append-friendly. */
export function primaryId(name = 'id') {
  return uuid(name)
    .primaryKey()
    .$defaultFn(() => uuidv7());
}

/** Every timestamp in this schema is `timestamptz`. There are no naive times. */
export function tstz(name: string) {
  return timestamp(name, { withTimezone: true, mode: 'date' });
}

export function tstzNow(name: string) {
  return tstz(name).notNull().defaultNow();
}
