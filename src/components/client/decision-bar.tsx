'use client';

/**
 * DecisionBar — Approve, or Request changes.
 *
 * Three rules, all of them load-bearing:
 *
 * 1. **The note is required on Request changes** and the submit control stays
 *    disabled until it has content. The domain enforces it and a CHECK enforces
 *    it; this is the third place, and it is the only one the client ever meets.
 * 2. **The decision binds to one immutable version** and the bar says which,
 *    in mono, before the decision is made — `v4 · 3a91f2…`. A person approving
 *    should be able to see, and later cite, exactly what they approved
 *    (ADR-004, INV-3).
 * 3. **Approve is confirmed, not fired.** It is the most consequential control
 *    in the product and it is one click away from a scroll gesture.
 *
 * "Request changes", never "Reject": the client is asking for work, not
 * refusing it, and the counter this increments is a contracted revision round.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ClientVersion } from '@/lib/types';
import { clientApi } from '@/lib/api-client';
import { shortHash, versionPip } from '@/lib/format';
import { useAction } from '@/lib/hooks/use-action';
import {
  buttonPrimary,
  buttonSecondary,
  cn,
  input,
  mono,
  muted,
  surface,
} from '@/components/style-tokens';
import { ErrorPanel } from './error-panel';

type Mode = 'idle' | 'confirming-approve' | 'requesting-changes';

export function DecisionBar({
  version,
  roundsUsed,
  contractedRounds,
}: {
  /** Always the latest published version — a decision never binds to an old one. */
  version: ClientVersion;
  roundsUsed: number;
  contractedRounds: number | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('idle');
  const [note, setNote] = useState('');
  const decide = useAction(clientApi.decide);

  const noteReady = note.trim().length > 0;
  const binding = `${versionPip(version.versionNo)} · ${shortHash(version.sha256)}`;

  async function send(decision: 'approved' | 'changes_requested') {
    const result =
      decision === 'approved'
        ? await decide.run('Approved', version.id, { decision })
        : await decide.run('Changes requested', version.id, { decision, note: note.trim() });
    if (result.ok) {
      setMode('idle');
      setNote('');
      router.refresh();
    }
  }

  if (decide.done) {
    return (
      <section className={cn(surface, 'px-4 py-3')} aria-live="polite">
        <p className="text-14 text-ink">{decide.done}</p>
        <p className={cn(mono, 'mt-1 text-12', muted)}>
          bound to {binding}
        </p>
      </section>
    );
  }

  return (
    <section className={cn(surface, 'px-4 py-3')} aria-label="Decision">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-16 text-ink">Your decision</h2>
        <span className={cn(mono, 'text-12', muted)} title={version.sha256}>
          binds to {binding}
        </span>
      </div>

      {mode === 'idle' && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={buttonPrimary} onClick={() => setMode('confirming-approve')}>
            Approve
          </button>
          <button
            type="button"
            className={buttonSecondary}
            onClick={() => setMode('requesting-changes')}
          >
            Request changes
          </button>
        </div>
      )}

      {mode === 'confirming-approve' && (
        <div className="mt-3 flex flex-col gap-2">
          <p className={cn('max-w-prose text-14', muted)}>
            Approving records your verified email, the time, and this file&rsquo;s hash against{' '}
            <span className={cn(mono, 'text-ink')}>{binding}</span>. It does not expire and it does
            not move to a later version.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonPrimary}
              disabled={decide.pending}
              onClick={() => void send('approved')}
            >
              {decide.pending ? 'Approving…' : 'Approve'}
            </button>
            <button type="button" className={buttonSecondary} onClick={() => setMode('idle')}>
              Back
            </button>
          </div>
        </div>
      )}

      {mode === 'requesting-changes' && (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!noteReady) return;
            void send('changes_requested');
          }}
        >
          <label htmlFor="decision-note" className="text-14 text-ink">
            What needs to change?
          </label>
          <textarea
            id="decision-note"
            required
            rows={4}
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Name the change you want. This note is attached to this version and stays with it."
            className={cn(input, 'resize-y')}
            aria-describedby="decision-note-help"
          />
          <p id="decision-note-help" className={cn('text-12', muted)}>
            A note is required. This is round{' '}
            <span className={mono}>{roundsUsed + 1}</span>
            {contractedRounds !== null && (
              <>
                {' '}of <span className={mono}>{contractedRounds}</span> contracted
              </>
            )}
            .
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={buttonPrimary} disabled={!noteReady || decide.pending}>
              {decide.pending ? 'Sending…' : 'Request changes'}
            </button>
            <button
              type="button"
              className={buttonSecondary}
              onClick={() => {
                setMode('idle');
                setNote('');
              }}
            >
              Back
            </button>
          </div>
        </form>
      )}

      {decide.failure && <ErrorPanel className="mt-3" failure={decide.failure} />}
    </section>
  );
}
