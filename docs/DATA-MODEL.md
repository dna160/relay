# Data Model

Postgres. All ids are uuid v7. All timestamps are `timestamptz`. Soft delete
does not exist except in the purge tombstone — everything else is real.

## Tables

### organizations
Agency tenant.
```
id, name, slug, plan ('free'|'pro'|'studio'), brand_logo_key, brand_primary,
brand_domain, created_at
```

### users
Agency-side members. Never billed per seat.
```
id, org_id -> organizations, email (citext, unique), name, role ('admin'|'member'),
created_at, last_seen_at
```

### engagements
**The aggregate root.** Unit of work, access, billing, and deletion.
```
id, org_id -> organizations, client_org_name, title,
status ('draft'|'active'|'archived'|'purged'),
template_id -> templates (nullable),
started_at, wrapped_at, last_activity_at, archive_at, purge_at,
contracted_rounds_default int, created_at
```
`last_activity_at` is bumped by any card transition, version upload, decision, or
note. It is the single input to both billing and expiry (INV-8).

### client_contacts
Client-side identity. Scoped to exactly one engagement (INV-6).
```
id, engagement_id -> engagements, email (citext), name, verified_at,
last_seen_at, invited_by -> users, created_at
UNIQUE (engagement_id, email)
```

### lanes
```
id, engagement_id, name, position int,
visibility ('published'|'private') NOT NULL DEFAULT 'published',
created_at
```

### cards
A requested deliverable.
```
id, engagement_id, lane_id, title, description,
state card_state NOT NULL DEFAULT 'draft',
position int,
assignee_id -> users (nullable, INTERNAL),
due_at, contracted_rounds int, rounds_used int DEFAULT 0,
internal_notes text (INTERNAL),
effort_estimate int (INTERNAL),
visibility_override ('inherit'|'private') DEFAULT 'inherit',
created_at, updated_at
```
Columns marked INTERNAL are never emitted by `client-view.ts`. Effective client
visibility = lane published AND override != private AND state != 'draft'.

### asset_versions
Append-only (INV-4). The object an approval binds to.
```
id, card_id, version_no int, storage_key, filename, mime, size_bytes,
sha256 char(64), uploaded_by_user_id, uploaded_at,
published_to_client_at (null until the internal gate is passed),
superseded_by -> asset_versions (nullable)
UNIQUE (card_id, version_no)
```

### approvals
```
id, asset_version_id -> asset_versions,
decision ('approved'|'changes_requested'),
decided_by_contact_id -> client_contacts (nullable),
decided_by_user_id -> users (nullable),
version_sha256 char(64) NOT NULL,   -- copied at decision time (INV-3)
note text, ip inet, user_agent text, decided_at
CHECK (decision = 'approved' OR note IS NOT NULL)
CHECK (num_nonnulls(decided_by_contact_id, decided_by_user_id) = 1)
```

### revision_notes
Threaded to a version. Never floats forward.
```
id, asset_version_id, author_contact_id, author_user_id, body,
internal bool DEFAULT false, created_at
```

### comments
Card-level discussion. Replaces the chat surface.
```
id, card_id, author_contact_id, author_user_id, body,
internal bool DEFAULT false, parent_id -> comments, created_at
```

### state_transitions
Sole source of possession data (ADR-010, INV-5).
```
id, card_id, from_state, to_state,
possession ('agency'|'client'),
actor_user_id, actor_contact_id, occurred_at
```
Possession duration for a card = sum over transitions of
`next.occurred_at - this.occurred_at` grouped by `possession`.

### reference_files
The shelf. No versioning, no approval, no tree.
```
id, engagement_id, group_label, storage_key, filename, mime, size_bytes,
uploaded_by_user_id, client_visible bool DEFAULT true, created_at
```

### templates
```
id, org_id, name, definition jsonb, created_at
```
`definition` holds lanes (with visibility), cards, contracted rounds, and shelf
groups. Stamping is a pure function: `applyTemplate(def) -> engagement graph`.

### purge_certificates
Survives the purge. Proves absence, not content.
```
id, engagement_id (no FK — the row it pointed at is gone),
org_id, engagement_title, client_org_name,
object_count int, total_bytes bigint, manifest_sha256 char(64),
purged_at, certificate_signature text
```

### audit_log
Append-only. Purged with the engagement except for retention actions.
```
id, org_id, engagement_id, actor, action, subject_type, subject_id,
metadata jsonb, occurred_at
```

## Enums

```sql
CREATE TYPE card_state AS ENUM (
  'draft','assigned','in_progress','internal_review',
  'awaiting_client','changes_requested','approved','signed_off'
);
CREATE TYPE possession AS ENUM ('agency','client');
CREATE TYPE lane_visibility AS ENUM ('published','private');
```

## Indexes that matter

```sql
CREATE INDEX ON engagements (org_id, status, last_activity_at);   -- active count
CREATE INDEX ON engagements (purge_at) WHERE status = 'archived'; -- purge sweep
CREATE INDEX ON cards (engagement_id, lane_id, position);
CREATE INDEX ON cards (assignee_id, state) WHERE state <> 'signed_off';
CREATE INDEX ON state_transitions (card_id, occurred_at);
CREATE UNIQUE INDEX ON asset_versions (card_id, version_no);
```

## Retention timeline

| Event | Trigger |
|---|---|
| `archive_at` | `last_activity_at + 30 days` |
| warnings | at archive, then +14d, +23d, +29d |
| `purge_at` | `last_activity_at + 60 days` |
| certificate | written in the same transaction as content deletion |

Paid plans null out `archive_at` and `purge_at`. Downgrading recomputes them and
sends a warning immediately — never purges silently on downgrade.
