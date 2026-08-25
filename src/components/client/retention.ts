/**
 * The second of FLOWS.md §3's three facts — the volume — as the client sees it.
 *
 * A copy of the agency helper's arithmetic rather than a shared import, and the
 * numbers it produces are deliberately **not** the same numbers. The agency's
 * count is of the whole engagement; this one counts what the client projection
 * actually carries, which is published lanes, published cards and versions that
 * passed the internal gate (INV-1).
 *
 * That difference is the point. Telling a client that 41 files are about to be
 * destroyed when they can only see 12 of them either leaks the existence of the
 * other 29 or reads as a mistake, and the client's export contains exactly what
 * the client projection can see — so the warning has to be counted from the same
 * place the export is generated from.
 *
 * | Fact | Counted as |
 * |---|---|
 * | files | published versions on visible cards |
 * | cards | cards on published lanes |
 * | approvals | cards resting in `approved` or `signed_off` — an under-count, the safe direction |
 */

import type { ClientLane } from '@/lib/types';
import type { RetentionCounts } from '@/lib/format';

export function retentionCountsFromLanes(lanes: ClientLane[]): RetentionCounts {
  let files = 0;
  let cards = 0;
  let approvals = 0;

  for (const lane of lanes) {
    for (const card of lane.cards) {
      cards += 1;
      files += card.versions.length;
      if (card.state === 'approved' || card.state === 'signed_off') approvals += 1;
    }
  }

  return { files, cards, approvals };
}
