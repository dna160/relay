/**
 * `POST /api/engagements/:id/invite` — adds a client contact and sends the link.
 *
 * Idempotent: re-inviting an existing contact re-sends the link rather than
 * creating a second identity for the same person.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import { loadEngagementDetail } from '@/db/queries/engagements';
import { inviteContact } from '@/domain/engagement/lifecycle';
import { engagementToken } from '@/lib/auth';
import { sendClientInvite } from '@/lib/email';
import { toErrorResponse } from '@/lib/errors';
import { requireAgency, type RouteContext } from '../../../_guards';

const schema = z.object({
  email: z.string().email(),
  name: z.string().max(200).nullish(),
});

export async function POST(
  request: Request,
  context: RouteContext<{ id: string }>,
): Promise<NextResponse> {
  try {
    const session = await requireAgency();
    const { id } = await context.params;
    const body = schema.parse(await request.json());
    const now = new Date();

    // Scoped load first: a wrong-org id is a 404 before anything is written.
    const engagement = await loadEngagementDetail(db, id, session.orgId, now);

    const { contact, created } = await inviteContact(
      db,
      {
        engagementId: engagement.id,
        email: body.email,
        name: body.name ?? null,
        invitedByUserId: session.userId,
      },
      now,
    );

    const base = process.env.AUTH_URL ?? 'http://localhost:3000';
    const linkUrl = `${base}/e/${engagementToken(engagement.id)}`;

    await sendClientInvite({
      to: body.email,
      engagementTitle: engagement.title,
      agencyName: engagement.agencyName,
      linkUrl,
      daysToPurge: engagement.daysToPurge,
    });

    return NextResponse.json(
      {
        contact: {
          id: contact.id,
          email: contact.email,
          name: contact.name,
          verifiedAt: contact.verifiedAt?.toISOString() ?? null,
        },
        created,
        linkUrl,
      },
      { status: created ? 201 : 200 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
