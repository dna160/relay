'use client';

/**
 * Who on the agency's side owns this card.
 *
 * `assigneeId` has been accepted by `POST /api/cards` and `PATCH /api/cards/:id`
 * since Phase 2, and `AgencyCard` has carried `assignee` for just as long. There
 * was simply never a control, so the owner asked *"How do I assign tasks? I
 * don't see a way to do it."* — a field the API had, the projection had, and the
 * interface did not.
 *
 * ## Why this is structural and not a detail-panel nicety
 *
 * Two facts in the code, both invisible from the design docs (COMPONENTS.md §17):
 *
 * 1. **`draft → assigned` is the only edge out of `draft`.** The board's first
 *    move is named after this control, so a product without it has a state
 *    machine whose first edge nobody can walk deliberately.
 * 2. **`rankAttention()` buckets on `assigneeId`.** `blocked_on_you` requires
 *    `assigneeId === viewerUserId`, and an unassigned stale card falls into
 *    `no_movement_7d`. On a board where nothing is assigned, `BLOCKED ON YOU` is
 *    permanently empty and `NO MOVEMENT IN 7 DAYS` quietly fills up — the
 *    agency's home screen degrades into a rot list, seven days after anyone
 *    would connect it to a missing picker.
 *
 * The second is the argument. This is not a convenience on a card; it is the
 * input to the screen the agency opens every morning.
 *
 * ## Two variants, one component
 *
 * - `row` — the Backstage `<dl>`. A plain edit. The `<dt>` "Assignee" is the
 *   label, so the control carries `labelHidden`.
 * - `forward` — the card's forward control while it is in `draft`. Choosing a
 *   person **is** the transition. Whether that is one request or two is not the
 *   person's problem: INV-2 means only the state machine writes `cards.state`,
 *   so it is two, and this component issues both rather than asking somebody to
 *   pick a name and then press a second button to tell the board about it. That
 *   second shape is what produces boards full of unassigned cards.
 *
 * **Never on `CardTile`.** The tile shows the result and never sets it — it is
 * one link, a control inside a link is a bad target, and there is no room at
 * 304px. Same call `FLOWS.md` §2 makes about the publish gate.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { agencyApi, type AssignableMember } from '@/lib/api-client.agency';
import { useAction } from '@/lib/hooks/use-action';
import { Button, Select } from '@/components/primitives';
import { cn, mono, muted } from '@/components/style-tokens';

/** The null case. First in the list, and a real option — see below. */
const UNASSIGNED = '';

export function AssigneePicker({
  engagementId,
  cardId,
  assignee,
  variant,
  readOnly = false,
  isDraft = false,
}: {
  engagementId: string;
  cardId: string;
  assignee: { id: string; name: string } | null;
  variant: 'row' | 'forward';
  /** An archived engagement is read-only: the name renders as text, no control. */
  readOnly?: boolean;
  /**
   * `row` only. When the card is still in `draft`, assigning from the row should
   * move it too — otherwise the two mounts disagree about what assigning means
   * depending on which one you happened to use.
   */
  isDraft?: boolean;
}) {
  const router = useRouter();
  const [members, setMembers] = useState<AssignableMember[] | null>(null);
  const [value, setValue] = useState(assignee?.id ?? UNASSIGNED);
  const assign = useAction(agencyApi.updateCard);
  const move = useAction(agencyApi.transitionCard);

  /**
   * The candidate list is read in the browser rather than threaded through the
   * page's props. It is the same list for every card on the engagement, it is
   * not needed to render the card, and making the server component wait on it
   * would put a second round trip in front of the first paint of a page whose
   * job is the versions and the transitions.
   */
  useEffect(() => {
    if (readOnly) return;
    let live = true;
    void agencyApi.members(engagementId).then((r) => {
      if (live && r.ok) setMembers(r.data);
    });
    return () => {
      live = false;
    };
  }, [engagementId, readOnly]);

  const pending = assign.pending || move.pending;
  const failure = assign.failure ?? move.failure;

  /**
   * Assign, and move the card if this is the act that starts it.
   *
   * The transition runs only when the assignment succeeded and only when a
   * person was actually chosen: `draft → assigned` with a null assignee would
   * be a card claiming to be assigned to nobody, which is a state the attention
   * ranker reads as assigned-and-therefore-not-rotting while no one owns it.
   */
  async function commit(next: string): Promise<void> {
    const previous = value;
    setValue(next);
    const assigneeId = next === UNASSIGNED ? null : next;
    const who = members?.find((m) => m.id === next);
    const label = assigneeId === null ? 'Unassigned' : `Assigned to ${personName(who)}`;

    const result = await assign.run(label, cardId, { engagementId, assigneeId });
    if (!result.ok) {
      // Put the control back to the truth. The `role="alert"` below carries the
      // reason; a select left showing a name that was never saved is worse than
      // the error itself.
      setValue(previous);
      return;
    }
    if (isDraft && assigneeId !== null) {
      await move.run(label, cardId, { engagementId, to: 'assigned' });
    }
    router.refresh();
  }

  /* ------------------------------------------------------------- read-only */

  if (readOnly) {
    return <span className="text-14 text-ink">{assignee?.name ?? 'Unassigned'}</span>;
  }

  /* --------------------------------------------------------------- loading */

  if (members === null) {
    /*
     * The current value as text, never an empty select. A control that renders
     * with nothing in it invites a press that cannot work, and on a slow read
     * that window is exactly when someone will press it.
     */
    return (
      <span className="text-14 text-ink" aria-busy="true">
        {assignee?.name ?? 'Unassigned'}
      </span>
    );
  }

  const status = (
    <>
      {failure && (
        <p role="alert" className="text-12 font-semibold text-ink">
          That didn&rsquo;t save. {failure.message}
        </p>
      )}
      {!failure && assign.done && (
        <p className={cn(mono, 'text-12', muted)}>{assign.done}</p>
      )}
    </>
  );

  /* ---------------------------------------------------------- one member */

  /**
   * An org with one member does not get a menu of one.
   *
   * Not hidden — a solo agency still needs the card to leave `draft`, and there
   * is no other edge out of it. Not auto-assigned either: a card that assigns
   * itself fills somebody's `BLOCKED ON YOU` with work they never accepted,
   * which is the same species of inference INV-14 forbids one step short of
   * sending mail about it. A menu of one is the interface making the reader do
   * its arithmetic, so the answer is one press. When a second member appears the
   * control becomes the picker with nothing to migrate and nothing to announce.
   */
  const only = members.length === 1 ? members[0] : undefined;
  if (only && assignee === null) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button tone="agency" size="sm" disabled={pending} onClick={() => void commit(only.id)}>
          Assign to me
        </Button>
        {status}
      </div>
    );
  }

  /* -------------------------------------------------------------- the list */

  /**
   * `Unassigned` is the first option and a real one — not an ✕, not "None",
   * not "—".
   *
   * `cards.assignee_id` is `ON DELETE SET NULL`, so the product already
   * manufactures unassigned cards without anybody choosing it: a person leaves
   * and their cards become unassigned. A card that got there that way has to
   * look identical to one that was never assigned, because it *is* the same
   * thing.
   */
  const options = [
    { value: UNASSIGNED, label: 'Unassigned' },
    ...members.map((m) => ({ value: m.id, label: personName(m) })),
  ];

  return (
    <div className={cn('flex flex-col gap-1', variant === 'row' && 'w-full max-w-dialog')}>
      <Select
        label={variant === 'forward' ? 'Assign to…' : 'Assignee'}
        labelHidden={variant === 'row'}
        options={options}
        value={value}
        disabled={pending}
        hint={
          variant === 'forward'
            ? 'Only people on this engagement can be assigned. Choosing one moves this off draft.'
            : undefined
        }
        onChange={(e) => void commit(e.target.value)}
      />
      {status}
    </div>
  );
}

/** A person's name, falling back to the address when they have not set one. */
function personName(m: AssignableMember | undefined): string {
  if (!m) return 'them';
  return m.name ?? m.email;
}
