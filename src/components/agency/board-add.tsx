'use client';

/**
 * The two "add" affordances a board needs. Both are deliberately one field:
 * a workspace that costs a modal to fill is a workspace that gets abandoned
 * for a spreadsheet, and everything else about a card is editable afterwards.
 *
 * Neither sends `state`. A new card is born in `draft` and the state machine
 * owns every move after that (INV-2).
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { agencyApi } from '@/lib/api-client.agency';
import { useAction } from '@/lib/hooks/use-action';
import { Button } from '@/components/primitives';
import { cn, input, mono, muted } from '@/components/style-tokens';

/**
 * The reason an archived engagement gives for a closed control.
 *
 * Stated on the control itself rather than only in the notice at the top of the
 * board: a disabled affordance with no explanation reads as a bug, and the
 * reader who reaches for it is not necessarily the reader who scrolled past the
 * notice.
 */
const ARCHIVED_REASON =
  'This engagement is archived and read-only. Nothing new can be added to it; everything in it is still here to read and to export.';

export function AddCardForm({
  engagementId,
  laneId,
  disabled = false,
}: {
  engagementId: string;
  laneId: string;
  /** An archived engagement returns 423 on every write (ENGAGEMENT_ARCHIVED). */
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const create = useAction(agencyApi.createCard);

  if (disabled) {
    return (
      <Button tone="ghost" block disabled title={ARCHIVED_REASON}>
        Add a deliverable
        <span className="sr-only"> — {ARCHIVED_REASON}</span>
      </Button>
    );
  }

  if (!open) {
    return (
      <Button tone="ghost" block onClick={() => setOpen(true)}>
        Add a deliverable
      </Button>
    );
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim()) return;
        const r = await create.run('Added', { engagementId, laneId, title: title.trim() });
        if (r.ok) {
          setTitle('');
          setOpen(false);
          router.refresh();
        }
      }}
    >
      <label className="sr-only" htmlFor={`add-card-${laneId}`}>
        Deliverable title
      </label>
      <input
        id={`add-card-${laneId}`}
        className={input}
        value={title}
        autoFocus
        placeholder="What is being delivered?"
        onChange={(e) => setTitle(e.target.value)}
      />
      <div className="flex gap-2">
        {/* `agency`: adding a deliverable moves nothing between the two
            sides, so the ball stays where it is — with us. */}
        <Button
          type="submit"
          tone="agency"
          loading={create.pending}
          loadingLabel="Adding"
          disabled={!title.trim()}
        >
          Add
        </Button>
        <Button tone="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {create.failure && (
        <p className={cn(mono, 'text-12', muted)}>{create.failure.code} — {create.failure.message}</p>
      )}
    </form>
  );
}

export function AddLaneForm({
  engagementId,
  disabled = false,
}: {
  engagementId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [isPrivate, setPrivate] = useState(false);
  const create = useAction(agencyApi.createLane);

  if (disabled) {
    return (
      <Button
        tone="ghost"
        className="w-card shrink-0 justify-start"
        disabled
        title={ARCHIVED_REASON}
      >
        Add a lane
        <span className="sr-only"> — {ARCHIVED_REASON}</span>
      </Button>
    );
  }

  if (!open) {
    return (
      <Button
        tone="ghost"
        className="w-card shrink-0 justify-start"
        onClick={() => setOpen(true)}
      >
        Add a lane
      </Button>
    );
  }

  return (
    <form
      className="flex w-card shrink-0 flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        const r = await create.run('Added', {
          engagementId,
          name: name.trim(),
          // Published by default (ADR-006). Private is always explicit.
          visibility: isPrivate ? 'private' : 'published',
        });
        if (r.ok) {
          setName('');
          setPrivate(false);
          setOpen(false);
          router.refresh();
        }
      }}
    >
      <label className="sr-only" htmlFor="add-lane-name">
        Lane name
      </label>
      <input
        id="add-lane-name"
        className={input}
        value={name}
        autoFocus
        placeholder="Lane name"
        onChange={(e) => setName(e.target.value)}
      />
      <label className="flex items-center gap-2 text-12 text-muted">
        <input
          type="checkbox"
          checked={isPrivate}
          onChange={(e) => setPrivate(e.target.checked)}
          className="accent-ink"
        />
        Keep this lane private to the agency
      </label>
      <div className="flex gap-2">
        <Button
          type="submit"
          tone="agency"
          loading={create.pending}
          loadingLabel="Adding"
          disabled={!name.trim()}
        >
          Add
        </Button>
        <Button tone="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {create.failure && (
        <p className={cn(mono, 'text-12', muted)}>{create.failure.code} — {create.failure.message}</p>
      )}
    </form>
  );
}
