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
import { agencyApi } from '@/lib/api-client';
import { useAction } from '@/lib/hooks/use-action';
import { buttonGhost, buttonPrimary, cn, input, mono, muted } from '@/components/style-tokens';

export function AddCardForm({ engagementId, laneId }: { engagementId: string; laneId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const create = useAction(agencyApi.createCard);

  if (!open) {
    return (
      <button type="button" className={cn(buttonGhost, 'w-full')} onClick={() => setOpen(true)}>
        Add a deliverable
      </button>
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
        <button type="submit" className={buttonPrimary} disabled={create.pending || !title.trim()}>
          {create.pending ? 'Adding…' : 'Add'}
        </button>
        <button type="button" className={buttonGhost} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {create.failure && (
        <p className={cn(mono, 'text-12', muted)}>{create.failure.code} — {create.failure.message}</p>
      )}
    </form>
  );
}

export function AddLaneForm({ engagementId }: { engagementId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [isPrivate, setPrivate] = useState(false);
  const create = useAction(agencyApi.createLane);

  if (!open) {
    return (
      <button
        type="button"
        className={cn(buttonGhost, 'w-card shrink-0 justify-start')}
        onClick={() => setOpen(true)}
      >
        Add a lane
      </button>
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
        <button type="submit" className={buttonPrimary} disabled={create.pending || !name.trim()}>
          {create.pending ? 'Adding…' : 'Add'}
        </button>
        <button type="button" className={buttonGhost} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {create.failure && (
        <p className={cn(mono, 'text-12', muted)}>{create.failure.code} — {create.failure.message}</p>
      )}
    </form>
  );
}
