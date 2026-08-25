/**
 * Retention date arithmetic — the 30/60 day timeline and the four warnings.
 *
 * This is the arithmetic that decides when a paying customer's files are
 * destroyed. It gets more tests than it looks like it needs.
 *
 * The live blocks cover `src/domain/retention/schedule.ts`, which exists. The
 * skipped block is the Phase 6 worker that acts on it — sending, idempotency,
 * resumability — which does not.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RETENTION,
  RETENTION_ARCHIVE_DAYS,
  RETENTION_PURGE_DAYS,
  WARNING_OFFSETS_DAYS,
  daysToPurge,
  retentionWindow,
  selectForArchive,
  warningDates,
} from '@/domain/retention/schedule';
import {
  DAY,
  ENGAGEMENT,
  EVAL_NOW,
  EXPECTED_DUE_FOR_ARCHIVE,
  ORG,
  RETENTION,
  T0,
  activityRows,
  archiveAtFor,
  days,
  engagementById,
  purgeAtFor,
  warningsFor,
} from '@tests/fixtures';

describe('the documented timeline', () => {
  it('archives at 30 days and purges at 60, both from last activity', () => {
    expect(RETENTION_ARCHIVE_DAYS).toBe(30);
    expect(RETENTION_PURGE_DAYS).toBe(60);
    expect(DEFAULT_RETENTION).toEqual({ archiveDays: 30, purgeDays: 60 });

    const window = retentionWindow('free', T0);
    expect(window.archiveAt?.toISOString()).toBe(archiveAtFor(T0));
    expect(window.purgeAt?.toISOString()).toBe(purgeAtFor(T0));
  });

  it('agrees with the fixture table the rest of the suite asserts against', () => {
    expect(RETENTION_ARCHIVE_DAYS).toBe(RETENTION.archiveDays);
    expect(RETENTION_PURGE_DAYS).toBe(RETENTION.purgeDays);
    expect([...WARNING_OFFSETS_DAYS]).toEqual([...RETENTION.warningOffsetDays]);
  });

  it('gives the agency 30 days of read-only grace between archive and purge', () => {
    expect(RETENTION_PURGE_DAYS - RETENTION_ARCHIVE_DAYS).toBe(30);
  });

  it('sends four warnings, at archive and +14d, +23d, +29d', () => {
    expect([...WARNING_OFFSETS_DAYS]).toEqual([0, 14, 23, 29]);
    const window = retentionWindow('free', T0);
    const offsets = warningDates(window.archiveAt!).map((d) => (d.getTime() - T0.getTime()) / DAY);
    expect(offsets).toEqual([30, 44, 53, 59]);
    expect(warningDates(window.archiveAt!).map((d) => d.toISOString())).toEqual(warningsFor(T0));
  });

  it('closes the gaps as the deadline approaches, rather than spacing them evenly', () => {
    // 14, 9, 6, then 1 day to the purge. Warnings that get closer together are
    // how someone who ignored the first one still acts on the last.
    const w = warningDates(retentionWindow('free', T0).archiveAt!).map((d) => d.getTime());
    const gaps = w.slice(1).map((t, i) => (t - w[i]!) / DAY);
    expect(gaps).toEqual([14, 9, 6]);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]!).toBeLessThan(gaps[i - 1]!);
  });

  it('leaves a full day between the last warning and the purge', () => {
    const { archiveAt, purgeAt } = retentionWindow('free', T0);
    const w = warningDates(archiveAt!);
    expect((purgeAt!.getTime() - w[3]!.getTime()) / DAY).toBe(1);
  });

  it('never schedules a warning after the purge', () => {
    const { archiveAt, purgeAt } = retentionWindow('free', T0);
    for (const d of warningDates(archiveAt!)) {
      expect(d.getTime()).toBeLessThan(purgeAt!.getTime());
    }
  });

  it('moves the whole schedule when last activity moves', () => {
    // bumpActivity() is called on every transition, upload, decision and note.
    // A stored archive_at that does not track activity purges live work.
    const a = retentionWindow('free', T0);
    const b = retentionWindow('free', new Date(T0.getTime() + days(7)));
    expect(b.archiveAt!.getTime() - a.archiveAt!.getTime()).toBe(days(7));
    expect(b.purgeAt!.getTime() - a.purgeAt!.getTime()).toBe(days(7));
  });

  it('accepts an overridden policy so the 60-day timeline can be exercised in a test run', () => {
    // .env.example exposes RETENTION_ARCHIVE_DAYS / RETENTION_PURGE_DAYS in dev
    // for exactly this reason.
    const window = retentionWindow('free', T0, { archiveDays: 1, purgeDays: 2 });
    expect(window.archiveAt!.getTime() - T0.getTime()).toBe(days(1));
    expect(window.purgeAt!.getTime() - T0.getTime()).toBe(days(2));
  });
});

describe('retaining plans', () => {
  it('null out the countdown rather than pushing it far into the future', () => {
    // A date that exists is a date some later bug can act on.
    for (const plan of ['pro', 'studio'] as const) {
      expect(retentionWindow(plan, T0), plan).toEqual({ archiveAt: null, purgeAt: null });
    }
  });

  it('report no days-to-purge at all, rather than a large number', () => {
    expect(daysToPurge(null, EVAL_NOW)).toBeNull();
    const retained = engagementById(ENGAGEMENT.retained);
    expect(retained.archiveAt).toBeNull();
    expect(retained.purgeAt).toBeNull();
  });
});

describe('days-to-purge, which every warning email carries', () => {
  it('counts whole days remaining on the archived fixture', () => {
    const archived = engagementById(ENGAGEMENT.archived);
    expect(daysToPurge(new Date(archived.purgeAt!), EVAL_NOW)).toBe(5);
  });

  it('rounds up, so "1 day" never means "in four hours"', () => {
    const purgeAt = new Date(EVAL_NOW.getTime() + 4 * 3_600_000);
    expect(daysToPurge(purgeAt, EVAL_NOW)).toBe(1);
  });

  it('clamps at zero rather than going negative once the date has passed', () => {
    expect(daysToPurge(new Date(EVAL_NOW.getTime() - days(3)), EVAL_NOW)).toBe(0);
  });

  it('has three of the four warnings already due on the archived fixture', () => {
    const archived = engagementById(ENGAGEMENT.archived);
    const due = warningDates(new Date(archived.archiveAt!)).filter((d) => d <= EVAL_NOW);
    expect(due).toHaveLength(3);
  });
});

describe('the archive sweep selection', () => {
  it('takes exactly the engagements the fixture declares overdue', () => {
    const overdue = selectForArchive(activityRows(ORG.free), EVAL_NOW);
    expect(overdue.map((e) => e.id)).toEqual([...EXPECTED_DUE_FOR_ARCHIVE]);
  });

  it('never takes a draft, an archived, or an already-purged engagement', () => {
    const taken = selectForArchive(activityRows(), EVAL_NOW).map((e) => e.id);
    for (const id of [ENGAGEMENT.draft, ENGAGEMENT.archived, ENGAGEMENT.purged]) {
      expect(taken, engagementById(id).title).not.toContain(id);
    }
  });

  it('leaves a retaining-plan engagement alone once it goes quiet', () => {
    // selectForArchive works on activity alone; the plan decides whether a
    // countdown exists at all. The retained fixture has no archive_at, so
    // nothing can act on it even when it stops moving.
    const retained = engagementById(ENGAGEMENT.retained);
    expect(retained.purgeAt).toBeNull();
    expect(retentionWindow('pro', new Date(retained.lastActivityAt)).archiveAt).toBeNull();
  });

  it('is empty when everything is fresh', () => {
    const fresh = activityRows(ORG.free).map((r) => ({ ...r, lastActivityAt: EVAL_NOW }));
    expect(selectForArchive(fresh, EVAL_NOW)).toEqual([]);
  });
});

describe.skip('the retention worker', () => {
  /**
   * UNSKIP IN: Phase 6 — Ephemerality. `src/workers/` does not exist yet.
   * The arithmetic above is already live; these are the behaviours around it.
   */

  it('sends each of the four warnings exactly once', () => {
    expect.fail(
      'Phase 6: the sweep is idempotent. Running it twice on the same day sends four warnings ' +
        'across the engagement lifetime, not eight.',
    );
  });

  it('sends every warning to both the agency and the client contacts', () => {
    expect.fail(
      'Phase 6, PRD §5.6: client contacts receive every notice the agency receives, plus the free ' +
        'one-click export link. A silent purge manufactures a contract breach.',
    );
  });

  it('includes the days-to-purge count in every warning', () => {
    expect.fail(
      'Phase 6, ARCHITECTURE NFR: every email referencing an engagement carries days-to-purge. ' +
        'daysToPurge() already exists — the worker must call it rather than formatting its own.',
    );
  });

  it('catches up rather than skipping when the sweep has not run for a week', () => {
    expect.fail(
      'Phase 6: a worker outage must not drop warnings. On resume, send the most recent unsent ' +
        'warning and mark the ones it passed, so the client still gets notice before the purge.',
    );
  });

  it('archives on the archive date and makes every mutation return 423', () => {
    expect.fail(
      'Phase 6: the "Pitch deck" fixture is 39 days idle with archive_at 9 days past. ' +
        'selectForArchive() already returns it; the worker must flip status and then every ' +
        'mutation returns 423 ENGAGEMENT_ARCHIVED.',
    );
  });

  it('refuses to purge an engagement that has not been warned four times', () => {
    expect.fail(
      'Phase 6 EXIT: purge asserts four warning rows exist before it destroys anything. This is ' +
        'the assertion that turns a scheduler bug into a no-op instead of a data loss.',
    );
  });

  it('never purges on the same tick as a downgrade', () => {
    expect.fail(
      'Phase 6/7: downgrading recomputes the dates and warns immediately. If the recomputed ' +
        'purge_at is already in the past, the countdown restarts from the warning — it does not fire.',
    );
  });
});

describe.skip('purge idempotency and resumability', () => {
  /**
   * UNSKIP IN: Phase 6. The invariant half lives in
   * `tests/invariants/inv-07-purge-leaves-certificate.spec.ts`; these are the
   * unit-level cases for the resume points `docs/RUNBOOK.md` documents.
   */

  it('records a resume point before each destructive step', () => {
    expect.fail('Phase 6: manifest -> objects -> rows -> certificate, each step checkpointed');
  });

  it('is safe to rerun after a kill at every step', () => {
    expect.fail('Phase 6: rerun after a kill at each checkpoint yields exactly one certificate');
  });

  it('treats an already-deleted object key as success, not as an error', () => {
    expect.fail('Phase 6: a resumed purge re-issues deletes for keys the first run already removed');
  });

  it('writes the certificate in the same transaction as the content row deletion', () => {
    expect.fail('Phase 6, INV-7: content gone and no certificate is the one unrecoverable outcome');
  });

  it('leaves every row and object count unchanged under --plan', () => {
    expect.fail('Phase 6 EXIT: npm run purge:plan prints the manifest and destroys nothing');
  });
});
