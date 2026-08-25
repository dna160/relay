/**
 * The second of FLOWS.md §3's three facts — the volume — derived from the board
 * the agency is already looking at.
 *
 * "41 files, 12 cards and 3 approvals" is what converts an abstract deletion
 * into a felt one, and a warning missing any of the three facts is a bug. So
 * the count has to come from somewhere, and today the only shape the agency
 * surface holds that knows how much is in an engagement is the board.
 *
 * **What each number actually counts, stated rather than implied:**
 *
 * | Fact | Counted as | Exact? |
 * |---|---|---|
 * | files | every `asset_version` on every card, including the ones that never passed the internal gate | yes for cards; excludes the reference shelf, which is a second read this strip must not wait on |
 * | cards | every card on every lane, private ones included | yes |
 * | approvals | cards resting in `approved` or `signed_off` | **an under-count** — an approval is a row against a version, and a card approved, revised, and approved again holds two |
 *
 * The approval line is the one that is not exact, and it is deliberately the
 * conservative direction: a warning that understates what is about to be
 * destroyed is survivable, one that overstates it is a false statement in a
 * notice that precedes an irreversible act.
 *
 * `GET /api/engagements/:id` gaining a counts block — object count, card count,
 * approval count, taken from the same query the purge manifest is built from —
 * replaces this file with a field read and makes all three exact. Raised with
 * the back-end; the manifest already has to compute exactly this.
 */

import type { AgencyLane } from '@/lib/types';
import type { RetentionCounts } from '@/lib/format';

export function retentionCountsFromLanes(lanes: AgencyLane[]): RetentionCounts {
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
