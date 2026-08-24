/**
 * One organization on each plan, plus the plan table PRD §5.8 specifies.
 *
 * These are the numbers the plan gate is tested against. If the implementation
 * disagrees with `PLAN_LIMITS` below, one of the two is wrong and the PRD
 * decides which — do not edit this table to match code.
 */

import { ORG, USER } from './ids';
import { iso } from './clock';

export type Plan = 'free' | 'pro' | 'studio';

export interface PlanLimits {
  /** Concurrent active engagements. `null` means unlimited (Studio). */
  activeEngagements: number | null;
  /** `null` means the engagement is never archived or purged — a retaining plan. */
  retentionDays: number | null;
  /** Logo and colour overrides. */
  whiteLabel: boolean;
  /** Custom domain, SSO, audit export. */
  customDomain: boolean;
}

/** PRD §5.8. One scaling unit: concurrent active engagements. */
export const PLAN_LIMITS: Readonly<Record<Plan, PlanLimits>> = {
  free: { activeEngagements: 3, retentionDays: 60, whiteLabel: false, customDomain: false },
  pro: { activeEngagements: 15, retentionDays: null, whiteLabel: true, customDomain: false },
  studio: { activeEngagements: null, retentionDays: null, whiteLabel: true, customDomain: true },
};

export interface OrgRow {
  id: string;
  name: string;
  slug: string;
  plan: Plan;
  brandLogoKey: string | null;
  brandPrimary: string | null;
  brandDomain: string | null;
  createdAt: string;
}

export const orgs: readonly OrgRow[] = [
  {
    id: ORG.free,
    name: 'Kestrel Studio',
    slug: 'kestrel',
    plan: 'free',
    brandLogoKey: null,
    brandPrimary: null,
    brandDomain: null,
    createdAt: iso(0),
  },
  {
    id: ORG.pro,
    name: 'Northline',
    slug: 'northline',
    plan: 'pro',
    brandLogoKey: 'brand/northline/logo.svg',
    brandPrimary: '#2f5d50',
    brandDomain: null,
    createdAt: iso(0),
  },
  {
    id: ORG.studio,
    name: 'Meridian Collective',
    slug: 'meridian',
    plan: 'studio',
    brandLogoKey: 'brand/meridian/logo.svg',
    brandPrimary: '#7a2f4f',
    brandDomain: 'work.meridian.co',
    createdAt: iso(0),
  },
];

export interface UserRow {
  id: string;
  orgId: string;
  email: string;
  name: string;
  role: 'admin' | 'member';
  createdAt: string;
  lastSeenAt: string | null;
}

export const users: readonly UserRow[] = [
  { id: USER.freeAdmin, orgId: ORG.free, email: 'ada@kestrel.test', name: 'Ada Okonjo', role: 'admin', createdAt: iso(0), lastSeenAt: iso(0) },
  { id: USER.proAdmin, orgId: ORG.pro, email: 'sam@northline.test', name: 'Sam Reyes', role: 'admin', createdAt: iso(0), lastSeenAt: iso(0) },
  { id: USER.proMember, orgId: ORG.pro, email: 'kit@northline.test', name: 'Kit Bauer', role: 'member', createdAt: iso(0), lastSeenAt: null },
  { id: USER.studioAdmin, orgId: ORG.studio, email: 'noor@meridian.test', name: 'Noor Haddad', role: 'admin', createdAt: iso(0), lastSeenAt: iso(0) },
];

export function orgById(id: string): OrgRow {
  const found = orgs.find((o) => o.id === id);
  if (!found) throw new Error(`fixture: no org ${id}`);
  return found;
}
