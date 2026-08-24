'use client';

/**
 * The agency's first five seconds.
 *
 * Auth.js creates a `users` row on the first magic-link verification, before
 * the person belongs to any organisation — `users.org_id` is nullable for
 * exactly that window (ADR-013). Until this form runs, `getSession()` refuses
 * to build an agency session and *every* agency route answers 401. So this is
 * not an optional setup wizard that can be skipped and returned to; it is the
 * one screen standing between a verified email and a product that works at all.
 *
 * Two fields, and the second fills itself. An onboarding flow that asks for a
 * team size and an industry before showing anything is a flow people abandon,
 * and none of it is needed to create the row.
 *
 * `POST /api/onboarding/org` is joinable exactly once — its update is predicated
 * on `org_id IS NULL`, so a double submit creates nothing and moves nobody
 * between agencies. It answers `VALIDATION_FAILED` on the second call, and the
 * copy below says the true thing about that rather than "something went wrong".
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/primitives';
import { agencyApi } from '@/lib/api-client.agency';
import { useAction } from '@/lib/hooks/use-action';
import { cn, input, mono, muted } from '@/components/style-tokens';
import { ErrorPanel } from './error-panel';

/** Lowercase letters, digits and hyphens — the server's rule, applied as you type. */
export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function OnboardingForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  // Once someone edits the slug by hand, the name stops overwriting it. A field
  // that silently reverts what you typed is worse than one that never helped.
  const [slugTouched, setSlugTouched] = useState(false);
  const onboard = useAction(agencyApi.onboardOrg);

  const effectiveSlug = slugTouched ? slug : toSlug(name);
  const ready = name.trim().length > 0 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(effectiveSlug);

  return (
    <form
      className="flex max-w-dialog flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready) return;
        const r = await onboard.run('Agency created', {
          name: name.trim(),
          slug: effectiveSlug,
        });
        if (r.ok) {
          // A hard navigation, not a client-side push: the session's org is
          // read on the server and every agency route was 401 a moment ago.
          router.replace('/portfolio');
          router.refresh();
        }
      }}
    >
      <label htmlFor="org-name" className="text-14 text-ink">
        Your agency&rsquo;s name
      </label>
      <input
        id="org-name"
        className={input}
        value={name}
        autoFocus
        autoComplete="organization"
        placeholder="Northlight Pictures"
        onChange={(e) => setName(e.target.value)}
      />
      <p className={cn('text-12', muted)}>
        This is what your clients see at the top of every workspace you send them.
      </p>

      <label htmlFor="org-slug" className="text-14 text-ink">
        Short name
      </label>
      <input
        id="org-slug"
        className={cn(input, mono)}
        value={effectiveSlug}
        inputMode="url"
        placeholder="northlight"
        aria-describedby="org-slug-help"
        onChange={(e) => {
          setSlugTouched(true);
          setSlug(toSlug(e.target.value));
        }}
      />
      <p id="org-slug-help" className={cn('text-12', muted)}>
        Lowercase letters, digits and hyphens. Used in links and in your exports.
      </p>

      <div>
        <Button
          type="submit"
          tone="agency"
          size="lg"
          loading={onboard.pending}
          loadingLabel="Creating"
          disabled={!ready}
        >
          Create the agency
        </Button>
      </div>

      {onboard.failure && <ErrorPanel failure={onboard.failure} />}
    </form>
  );
}
