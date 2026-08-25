/**
 * The purge worker's view of object storage.
 *
 * `src/lib/storage.ts` throws when the four `S3_*` variables are absent, which
 * is right for an upload — a presign that cannot be signed must fail loudly.
 * It is wrong for a **dry run**: `npm run purge:plan` is the thing an operator
 * reaches for when they are not sure what is going on, and CI runs it with no
 * object-store credentials at all. A plan that dies on a missing credential
 * tells nobody anything.
 *
 * So listing degrades: no credentials means keys come from the database only,
 * and the manifest says `bucketListed: false` so that nobody mistakes a partial
 * enumeration for a complete one. **Deleting does not degrade** — a purge that
 * cannot reach the bucket must fail rather than certify a deletion it did not
 * perform.
 */

import { deleteObjects, listEngagementObjects } from '@/lib/storage';
import type { ObjectStore } from './purge';
import { log, errorText } from './logger';

function configured(): boolean {
  return (
    typeof process.env.S3_ENDPOINT === 'string' &&
    typeof process.env.S3_ACCESS_KEY_ID === 'string' &&
    typeof process.env.S3_SECRET_ACCESS_KEY === 'string' &&
    typeof process.env.S3_BUCKET === 'string' &&
    process.env.S3_ENDPOINT.length > 0 &&
    process.env.S3_BUCKET.length > 0
  );
}

export const objectStore: ObjectStore = {
  async list(engagementId: string) {
    if (!configured()) {
      log.warn('storage.not_configured', {
        engagementId,
        detail: 'listing skipped; manifest built from database keys only',
      });
      return { keys: [], listed: false };
    }
    try {
      return { keys: await listEngagementObjects(engagementId), listed: true };
    } catch (error) {
      log.warn('storage.list_failed', { engagementId, error: errorText(error) });
      return { keys: [], listed: false };
    }
  },

  async remove(keys: readonly string[]) {
    if (keys.length === 0) return 0;
    if (!configured()) {
      throw new Error(
        'refusing to purge: object storage is not configured, so the bytes cannot be ' +
          'destroyed. A certificate issued now would claim a deletion that did not happen.',
      );
    }
    return deleteObjects(keys);
  },
};

/**
 * A store that lists nothing and refuses to delete. Used by `--plan`, so that
 * a dry run cannot destroy an object even if a future edit routes it here by
 * mistake.
 */
export const readOnlyStore: ObjectStore = {
  list: (engagementId) => objectStore.list(engagementId),
  remove() {
    return Promise.reject(new Error('--plan destroys nothing'));
  },
};
