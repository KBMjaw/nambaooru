# நம்ம ஊர் · Namma Ooru

**Single Window Civic Complaint & Resolution Portal** for Tamil Nadu local bodies.
*Simple for Citizens. Simple for Field Staff. Powerful for Officers. Transparent for Everyone.*

Citizens describe a problem in their own words — formal or spoken Tamil, Tanglish, English or mixed, typed or by voice.
The platform understands it, collects GPS + photo evidence, detects duplicates, routes it to the right department of the right
local body, and tracks inspection → assignment → work → verification → closure with a complete audit trail.

| Portal | Path | Who |
|---|---|---|
| Public | `/` | Citizens: register/login, voice & text chatbot, evidence, tracking, notifications, reconsideration |
| Officer | `/office` | EO, Supervisor, Department Officer, Field Staff, Ward Member (role-specific views) |
| Admin | `/admin` | Super Admin, System/Technology Admin |

## Architecture

- **Next.js 16 (App Router) + TypeScript + Tailwind v4**, deployed on Vercel.
- **PostgreSQL** (Supabase) via `postgres.js`; schema in `db/schema.sql`, reference data in `db/seed.sql`.
- **Auth**: bcrypt password hashes, HS256 JWT in httpOnly/SameSite cookies — one cookie per portal. The portal a user can enter is
  derived from their role *in the database*; every page and API re-loads the user, status and permissions server-side, so URLs,
  request bodies or client state cannot grant access. Deactivation / password reset / role change bump `token_version` and revoke sessions.
- **RBAC**: `roles` × `permissions` (configurable in `/admin/roles`) + **jurisdiction scoping** (`src/lib/scope.ts`):
  EO → local body, Supervisor/Dept officer → department in local body, Ward member → ward, Field staff → own assignments,
  Citizen → own complaints. Out-of-scope complaints are simply "not found".
- **Workflow**: explicit state machine (`src/lib/workflow.ts`) — SUBMITTED → AI_CLASSIFIED → INITIAL_REVIEW → SITE_INSPECTION →
  VERIFIED / REJECTED / DUPLICATE → ASSIGNED → IN_PROGRESS → WORK_COMPLETED → COMPLETION_VERIFIED → CLOSED (+ REOPENED via appeal).
  AI never moves a complaint past AI_CLASSIFIED; verification, rejection (always with reason), assignment, completion approval and
  closure are human decisions. Completion needs photo + GPS and must be verified by a *different* official.
- **Audit**: `audit_logs` and `complaint_status_history` are append-only (DB triggers block UPDATE/DELETE); user-management entries
  record actor, target, old/new values, IP and user-agent.
- **NLP** (`src/lib/nlp`): dependency-free Tamil/Tanglish/English engine — fuzzy, suffix-tolerant matching ("streetla", "eriyalai"),
  Tamil number words ("rendu naala", "பத்தாவது வார்டு"), ward/street extraction against the location master, duration, safety cues,
  severity, bilingual summaries. Optional Claude refinement when `ANTHROPIC_API_KEY` is set (Admin → Settings → AI).
  Voice uses the browser Web Speech API (`ta-IN` / `en-IN`).
- **Evidence**: images re-encoded on device (EXIF stripped, ≤1600px), perceptual hash for duplicate detection, server-side magic-byte
  validation, stored in Postgres and served only to the owner or officials in jurisdiction.
- **Location master data**: state → district → taluk/block → local body (Corporation / Municipality / Town Panchayat / Village Panchayat)
  → ward → street, plus postal data (`postal_locations`, `pincodes`, `post_offices`) linked many-to-many through
  `postal_location_jurisdictions`. A pincode is only a lookup aid — never a jurisdiction. Admins import/export CSVs without code changes;
  records are deactivated, never deleted. The supplied Tamil Nadu dataset is in `data/tn_postal_locations.csv`
  (776 rows → 43 exact duplicates removed → 733 places, originals preserved, source recorded).

Chennimalai Town Panchayat (Erode) is the pilot; nothing is hard-coded to it (a second local body, Perundurai, demonstrates isolation).

## Administration, RBAC & jurisdiction (migration 002)

- **USER → ROLE → PERMISSIONS → JURISDICTION.** Roles are rows in `roles` (built-in or custom such as JE, Electrician,
  Plumber, EB Lineman), each with a default scope (`SYSTEM`, `DISTRICT`, `LOCAL_BODY`, `DEPARTMENT`, `WARD`, `ASSIGNED`, `OWN`)
  and an authority rank. Permissions come from `role_permissions` plus per-user GRANT/DENY overrides (`user_permissions`).
  Jurisdiction comes from `user_jurisdictions` (primary + additional grants; revoked rows are kept as history).
  Everything is enforced server-side in `src/lib/scope.ts` and `src/lib/users.ts`.
- **Super Admin protection.** Only a holder of `user.manage.all` (Super Admin) can create, edit, reset, deactivate or change
  the role of a Super Admin; nobody can manage a peer or higher rank; security permissions stay with Super Admin.
- **Passwords.** bcrypt hashes only. Admin-created users and admin resets get a one-time temporary password and must set
  their own at first login (`must_change_password`). Audit rows record `PASSWORD_CHANGED` / `PASSWORD_RESET` with the source,
  never any password value (`redact()` strips secret-looking keys from every audit payload).
- **Audit vs security log.** Business events (`USER_CREATED`, `ROLE_CHANGED`, `JURISDICTION_CHANGED`, `COMPLAINT_ASSIGNED`,
  `ACTION_UPDATED`, `WARD_MAP_UPDATED` …) go to `audit_logs`; logins, failures, lockouts and logouts go to `security_logs`.
  Both are append-only (DB triggers).
- **Bulk users.** `/admin/users/bulk` — CSV or Excel template (with live reference lists), row-level validation, all-or-nothing
  or valid-rows-only import inside one transaction with a savepoint per row (`src/lib/bulk-users.ts`).
- **Locations.** `/admin/local-bodies/new` creates a local body with controlling authority, responsible officer, departments
  and N generated wards; wards carry population / description / street count; `/…/ward-maps/[ward]` draws GeoJSON features.
- **Complaint actions.** `complaint_actions` with primary + supporting assignees and an append-only update log; complaint work
  assignments also support supporting assignees.

Apply the migration with `npm run db:migrate` (runs `db/schema.sql` then `db/migrations/*.sql`, all idempotent) followed by
`npm run db:seed`. Demo passwords can be set from a local, git-ignored JSON file:
`PASSWORDS_FILE=path.json node --experimental-strip-types scripts/db.ts set-passwords`.

Tests: `npm test` (NLP), `node tests/e2e.mjs`, `node tests/admin-e2e.mjs`, `node tests/smoke-pages.mjs` against a running server.

## Local development

```bash
npm install
cp .env.example .env.local          # fill DATABASE_URL, AUTH_SECRET, APP_ENCRYPTION_KEY
set -a; . ./.env.local; set +a
npm run db:migrate && npm run db:seed
node --experimental-strip-types scripts/db.ts bootstrap   # creates Super Admin + demo officials; passwords → scripts/.credentials.json
npm run dev
npm test                                                   # NLP unit tests
node tests/e2e.mjs http://localhost:3000                   # full workflow + security test (needs IMG_DIR with before/after/insp.jpg)
node tests/smoke-pages.mjs http://localhost:3000           # every page × role
```

## Environment

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection (Supabase pooler, **session** mode, port 5432) |
| `AUTH_SECRET` | ≥32 chars, signs session JWTs |
| `APP_ENCRYPTION_KEY` | 32-byte base64 AES-256-GCM key for citizen DOB/address |
| `CRON_SECRET` | protects `/api/cron/sla` (Vercel Cron, daily) |
| `ANTHROPIC_API_KEY` | optional — enables LLM refinement of complaint understanding |

## Future phase hooks

Aadhaar/eKYC (`citizens.identity_verified`, no Aadhaar number stored), SMS/WhatsApp/Email/Push (queued rows in `notifications`
per template channel), more Indian languages (`languages` table + message file in `src/i18n`), GIS polygons for wards, AI image analysis.
