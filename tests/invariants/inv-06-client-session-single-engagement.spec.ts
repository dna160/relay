/**
 * INV-6 — A client session is scoped to exactly one engagement. There is no
 * cross-engagement client identity.
 *
 * Client routes take the engagement from the session, never from the request.
 * A client route that accepts an engagementId parameter is a bug (API-CONTRACT).
 *
 * UNSKIPPED IN: Phase 1 — the `Session` union and the `client_contacts`
 * migration landed. The DB-behavioural cases below stay skipped until there is
 * a client verify route to drive; each names its phase.
 *
 * Never edit this file to make a build pass.
 */

import { describe, expect, it, expectTypeOf } from 'vitest';
import { isClientSession, type Session } from '@/lib/types';
import { except, linesMatching, sourceFiles } from './_source';
import { allMigrationSql, createTableBody, hasMigrations } from './_sql';
import { CONTACT, clientContacts } from '@tests/fixtures';

describe('INV-6 a client session sees exactly one engagement', () => {
  it('the client session type carries exactly one engagementId', () => {
    const session: Session = { kind: 'client', contactId: CONTACT.active, engagementId: 'e1' };
    expect(isClientSession(session)).toBe(true);
    if (!isClientSession(session)) return;

    // A string, not a list. A list is how "one engagement" becomes "a few".
    expectTypeOf(session.engagementId).toEqualTypeOf<string>();
    expect(Object.keys(session).sort()).toEqual(['contactId', 'engagementId', 'kind']);
  });

  it('the agency session carries an org, and the client session carries no org at all', () => {
    // A client session that knows an org id is one join away from a second
    // engagement.
    const client: Session = { kind: 'client', contactId: CONTACT.active, engagementId: 'e1' };
    expect(JSON.stringify(client)).not.toContain('orgId');
  });

  /**
   * The retention sweeps are definitionally multi-engagement: archiving,
   * warning and purging all run over every engagement that is due. They carry
   * no session at all — they are cron work, not a request.
   *
   * They are excluded from the list scan below, and that exclusion is paid for
   * by the test immediately after it, which asserts they cannot reach a session
   * or a client scope. Excluding them without that second assertion would turn
   * this invariant into a loophole shaped exactly like the thing it forbids.
   */
  const SWEEPS = ['src/db/queries/retention.ts', 'src/workers/retention.ts', 'src/workers/purge.ts'];

  it('no session type anywhere in the tree holds a list of engagements', () => {
    const offenders: string[] = [];
    for (const file of except(sourceFiles(), ...SWEEPS)) {
      for (const line of linesMatching(file, /engagementIds\s*[?:]|engagements\s*:\s*(string\[\]|Array<)/)) {
        offenders.push(`${file.path}: ${line}`);
      }
    }
    expect(offenders, 'a session widened to several engagements').toEqual([]);
  });

  it('the multi-engagement sweeps cannot reach a session or a client scope', () => {
    // This is what buys the exclusion above. A sweep that could build a client
    // scope could serve one engagement's content under another's session.
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      if (!SWEEPS.includes(file.path)) continue;
      for (const re of [/clientScope/, /requireClient/, /\bSession\b/, /getSession/]) {
        for (const line of linesMatching(file, re)) offenders.push(`${file.path}: ${line}`);
      }
    }
    expect(offenders, 'a retention sweep reached for a session').toEqual([]);
  });

  it('no client route reads an engagement id from params, query, or body', () => {
    // Phase 4 creates these routes; until then the set is empty and the
    // invariant holds vacuously, which is the point of checking it from Phase 1.
    const offenders: string[] = [];
    for (const file of sourceFiles('app')) {
      if (!file.path.includes('/api/client/')) continue;
      const hits = linesMatching(
        file,
        /engagementId\s*:\s*z\.|params\.\s*engagementId|searchParams\.get\(\s*['"]engagementId|body\.\s*engagementId/,
      );
      for (const line of hits) offenders.push(`${file.path}: ${line}`);
    }
    expect(offenders, 'a client route accepted an engagement id from the request').toEqual([]);
  });

  it('client contacts are unique per engagement, not globally', () => {
    if (!hasMigrations()) return; // Phase 1 creates the migration.
    const sql = allMigrationSql();
    expect(sql, 'UNIQUE (engagement_id, email) is what actually enforces INV-6').toMatch(
      /CREATE UNIQUE INDEX[^;]*ON "client_contacts"[^;]*"engagement_id"\s*,\s*"email"/i,
    );
  });

  it('client_contacts has no global unique on email alone', () => {
    const body = createTableBody('client_contacts');
    if (body === null) return; // Phase 1 creates the table.
    // A global unique on email would make one person one identity across every
    // agency using Relay — the cross-engagement account ADR-005 refuses to ship.
    expect(body).not.toMatch(/UNIQUE\s*\(\s*"email"\s*\)/i);
    expect(allMigrationSql()).not.toMatch(
      /CREATE UNIQUE INDEX[^;]*ON "client_contacts"\s*USING btree\s*\(\s*"email"\s*\)/i,
    );
  });

  it('client_contacts is scoped by a NOT NULL engagement_id', () => {
    const body = createTableBody('client_contacts');
    if (body === null) return;
    expect(body).toMatch(/"engagement_id"\s+uuid\s+NOT NULL/i);
  });

  it('the same email in two engagements produces two unrelated contacts', () => {
    const rowan = clientContacts.filter((c) => c.email === 'rowan@bellweather.test');
    expect(rowan.length).toBeGreaterThan(1);
    expect(new Set(rowan.map((c) => c.engagementId)).size).toBe(rowan.length);
    expect(new Set(rowan.map((c) => c.id)).size, 'one row shared across engagements').toBe(
      rowan.length,
    );
  });
});

describe.skip('INV-6 at the session boundary', () => {
  /**
   * UNSKIP IN: Phase 4 — the client surface. These need a verify route to
   * drive and a cookie to inspect; `src/app/api/auth/client/` does not exist.
   */

  it('a verified contact cannot widen its session to a second engagement', () => {
    expect.fail(
      'Phase 4: verifying a second link issues a separate session cookie, never a merged one. ' +
        'The fixture holds the same email on two engagements for exactly this test.',
    );
  });

  it('a session issued for engagement A returns 404 NOT_VISIBLE for B', () => {
    expect.fail(
      'Phase 1 EXIT / Phase 4: 404, never 403 — a 403 confirms that B exists (API-CONTRACT).',
    );
  });

  it('the session cookie is signed and cannot be re-scoped by editing it', () => {
    expect.fail('Phase 4: CLIENT_LINK_SECRET signs the scope; tampering invalidates the session');
  });
});
