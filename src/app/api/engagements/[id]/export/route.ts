/**
 * `POST /api/engagements/:id/export` — queues a bundle, returns a job id.
 *
 * Deliberately **not** guarded by `assertWritable`. Export is the one thing an
 * archived engagement must still do: the archive is read-only, and export is
 * how it is escaped. Refusing it here would mean the retention countdown
 * destroys work the agency was never able to take out — which is the failure
 * mode the four warnings exist to prevent, reintroduced at the last step.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import { loadEngagementDetail } from '@/db/queries/engagements';
import { toErrorResponse } from '@/lib/errors';
import { validationFailed } from '@/domain/errors';
import { QUEUES, getBoss } from '@/workers/queue';
import type { ExportJobData } from '@/workers/export';
import { requireAgency, type RouteContext } from '../../../_guards';
import { shadowed } from '../../../_shadow';

/** No body today. `.strict()` so a future field cannot be silently ignored. */
const bodySchema = z.object({}).strict();

export async function POST(
  request: Request,
  context: RouteContext<{ id: string }>,
): Promise<NextResponse> {
  try {
    const session = await requireAgency();
    const { id } = await context.params;

    const raw: unknown = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw ?? {});
    if (!parsed.success) throw validationFailed('Unexpected field', parsed.error.flatten());

    // Org-scoped: another org's engagement is 404, never 403 (INV-1's rule
    // applied to tenancy — a 403 would confirm the engagement exists).
    const engagement = await shadowed('POST /api/engagements/[id]/export', session, id, () =>
      loadEngagementDetail(db, id, session.orgId, new Date()),
    );

    const data: ExportJobData = {
      engagementId: engagement.id,
      requestedByUserId: session.userId,
    };

    const boss = await getBoss();
    const jobId = await boss.send(QUEUES.exportBuild, data);
    if (jobId === null) throw new Error('export job was not accepted by the queue');

    return NextResponse.json({ jobId, engagementId: engagement.id }, { status: 202 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
