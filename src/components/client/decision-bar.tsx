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
import { clientApi } from '@/lib/api-client.client';
import { shortHash, versionPip } from '@/lib/format';
import { useAction } from '@/lib/hooks/use-action';
import { Button, Textarea } from '@/components/primitives';
import { cn, mono, muted, surface } from '@/components/style-tokens';
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
          {/*
            Both controls are pine, and that is not a mistake. A button's hue
            names the side that holds the work once it has been pressed, and
            both of these hand it straight back to the agency. What tells them
            apart is fill against quiet — the weight of the act — not the hue,
            because their consequence for possession is identical.
          */}
          <Button tone="agency" size="lg" onClick={() => setMode('confirming-approve')}>
            Approve
          </Button>
          <Button tone="quiet" size="lg" onClick={() => setMode('requesting-changes')}>
            Request changes
          </Button>
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
            <Button
              tone="agency"
              size="lg"
              loading={decide.pending}
              loadingLabel="Approving"
              onClick={() => void send('approved')}
            >
              Approve
            </Button>
            <Button tone="quiet" size="lg" onClick={() => setMode('idle')}>
              Back
            </Button>
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
          {/*
            The `Textarea` primitive rather than the raw `input` class string
            this used to carry. That string is 14px, and 14px is under the
            threshold at which iOS Safari zooms the viewport on focus — on the
            highest-stakes field in the product, reached on a phone, where the
            note being typed is what a contracted revision round is spent on.
            `Textarea` is 16px and keeps hint and error in one slot, so the
            "a note is required" message cannot push the Request changes button
            out from under a thumb mid-sentence.

            The round count loses its mono face in the hint, because the hint is
            typed `string`. It is still in mono on the card header directly
            above, which is where it is a record being cited rather than a
            sentence being read.
          */}
          <Textarea
            label="What needs to change?"
            required
            rows={4}
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Name the change you want. This note is attached to this version and stays with it."
            hint={`A note is required. This is round ${roundsUsed + 1}${
              contractedRounds === null ? '' : ` of ${contractedRounds} contracted`
            }.`}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              tone="agency"
              size="lg"
              loading={decide.pending}
              loadingLabel="Sending"
              disabled={!noteReady}
            >
              Request changes
            </Button>
            <Button
              tone="quiet"
              size="lg"
              onClick={() => {
                setMode('idle');
                setNote('');
              }}
            >
              Back
            </Button>
          </div>
        </form>
      )}

      {decide.failure && <ErrorPanel className="mt-3" failure={decide.failure} />}
    </section>
  );
}
