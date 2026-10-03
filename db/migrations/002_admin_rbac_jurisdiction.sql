-- ============================================================================
-- Namma Ooru — migration 002: dynamic roles, permission-based RBAC with
-- jurisdictions, password security, security log, complaint actions,
-- multi-person assignment, ward maps, bulk user import.
-- Idempotent: safe to re-run. Applied after db/schema.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ROLES: dynamic / custom roles
-- default_scope decides how far a role's jurisdiction reaches:
--   SYSTEM      whole state (Super Admin, Admin)
--   DISTRICT    assigned district(s)
--   LOCAL_BODY  assigned local body (EO)
--   DEPARTMENT  assigned department within assigned local body (Supervisor, Dept Officer, JE)
--   WARD        assigned ward (Ward Member)
--   ASSIGNED    only work assigned to the user (Field staff, Electrician, Plumber …)
--   OWN         own records only (Citizen)
-- ---------------------------------------------------------------------------
ALTER TABLE roles ADD COLUMN IF NOT EXISTS description     TEXT;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS department_code TEXT;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS default_scope   TEXT NOT NULL DEFAULT 'ASSIGNED';
ALTER TABLE roles ADD COLUMN IF NOT EXISTS status          TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE roles ADD COLUMN IF NOT EXISTS created_by      UUID REFERENCES users(id);
ALTER TABLE roles ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE roles ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ NOT NULL DEFAULT now();
DO $$ BEGIN
  ALTER TABLE roles ADD CONSTRAINT roles_scope_chk CHECK (default_scope IN ('SYSTEM','DISTRICT','LOCAL_BODY','DEPARTMENT','WARD','ASSIGNED','OWN'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE roles ADD CONSTRAINT roles_status_chk CHECK (status IN ('ACTIVE','INACTIVE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

UPDATE roles SET default_scope = 'SYSTEM'     WHERE code IN ('SUPER_ADMIN','SYSTEM_ADMIN') AND default_scope <> 'SYSTEM';
UPDATE roles SET default_scope = 'LOCAL_BODY' WHERE code = 'EO' AND default_scope <> 'LOCAL_BODY';
UPDATE roles SET default_scope = 'DEPARTMENT' WHERE code IN ('SUPERVISOR','DEPT_OFFICER') AND default_scope <> 'DEPARTMENT';
UPDATE roles SET default_scope = 'WARD'       WHERE code = 'WARD_MEMBER' AND default_scope <> 'WARD';
UPDATE roles SET default_scope = 'OWN'        WHERE code = 'CITIZEN' AND default_scope <> 'OWN';
UPDATE roles SET name_en = 'Admin (System Admin)' WHERE code = 'SYSTEM_ADMIN' AND name_en = 'System / Technology Admin';

ALTER TABLE permissions ADD COLUMN IF NOT EXISTS label      TEXT;   -- e.g. VIEW_CITIZENS
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS perm_group TEXT;   -- UI grouping

-- Role assignment history (the current role is users.role_id; history is never overwritten)
CREATE TABLE IF NOT EXISTS user_roles (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES users(id),
  role_id      INTEGER NOT NULL REFERENCES roles(id),
  assigned_by  UUID REFERENCES users(id),
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_by   UUID REFERENCES users(id),
  revoked_at   TIMESTAMPTZ,
  reason       TEXT
);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id, assigned_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_roles_current ON user_roles(user_id) WHERE revoked_at IS NULL;

-- Per-user permission overrides on top of the role (GRANT adds, DENY removes)
CREATE TABLE IF NOT EXISTS user_permissions (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id),
  permission_id INTEGER NOT NULL REFERENCES permissions(id),
  effect        TEXT NOT NULL DEFAULT 'GRANT' CHECK (effect IN ('GRANT','DENY')),
  granted_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_by    UUID REFERENCES users(id),
  revoked_at    TIMESTAMPTZ,
  reason        TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_permissions_active ON user_permissions(user_id, permission_id) WHERE revoked_at IS NULL;

-- Jurisdictions: a user may hold several. A row matches data when every non-null
-- column matches (district → taluk → local body → ward, optionally narrowed to a department).
-- is_primary mirrors the officials row; revoked rows are kept as history.
CREATE TABLE IF NOT EXISTS user_jurisdictions (
  id             BIGSERIAL PRIMARY KEY,
  user_id        UUID NOT NULL REFERENCES users(id),
  state_id       INTEGER REFERENCES states(id),
  district_id    INTEGER REFERENCES districts(id),
  taluk_id       INTEGER REFERENCES taluks(id),
  local_body_id  INTEGER REFERENCES local_bodies(id),
  ward_id        INTEGER REFERENCES wards(id),
  street_id      INTEGER REFERENCES streets(id),
  department_id  INTEGER REFERENCES departments(id),
  is_primary     BOOLEAN NOT NULL DEFAULT false,
  granted_by     UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_by     UUID REFERENCES users(id),
  revoked_at     TIMESTAMPTZ,
  reason         TEXT
);
CREATE INDEX IF NOT EXISTS idx_uj_user ON user_jurisdictions(user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_uj_lb ON user_jurisdictions(local_body_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_uj_primary ON user_jurisdictions(user_id) WHERE is_primary AND revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- USERS: password lifecycle
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at  TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status_reason        TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username_lower ON users(lower(username));

-- Admin-created citizens may not have a date of birth on record
ALTER TABLE citizens ALTER COLUMN dob_enc DROP NOT NULL;
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS created_by_official UUID REFERENCES users(id);

-- ---------------------------------------------------------------------------
-- LOCATIONS: controlling authority, ward details
-- ---------------------------------------------------------------------------
ALTER TABLE local_bodies ADD COLUMN IF NOT EXISTS controlling_authority  TEXT;   -- e.g. Executive Officer / Commissioner / BDO
ALTER TABLE local_bodies ADD COLUMN IF NOT EXISTS responsible_officer_id UUID REFERENCES users(id);
ALTER TABLE local_bodies ADD COLUMN IF NOT EXISTS pincode                CHAR(6);
ALTER TABLE local_bodies ADD COLUMN IF NOT EXISTS ward_count             INTEGER;
ALTER TABLE local_bodies ADD COLUMN IF NOT EXISTS created_by             UUID REFERENCES users(id);
UPDATE local_bodies SET controlling_authority = CASE code WHEN 'MUN-ERD-PERUNDURAI' THEN 'Commissioner' ELSE 'Executive Officer' END
 WHERE controlling_authority IS NULL AND code IN ('TP-ERD-CHENNIMALAI','MUN-ERD-PERUNDURAI');
UPDATE local_bodies lb SET ward_count = (SELECT count(*) FROM wards w WHERE w.local_body_id = lb.id) WHERE ward_count IS NULL;

ALTER TABLE wards ADD COLUMN IF NOT EXISTS population   INTEGER CHECK (population IS NULL OR population >= 0);
ALTER TABLE wards ADD COLUMN IF NOT EXISTS description  TEXT;
ALTER TABLE wards ADD COLUMN IF NOT EXISTS street_count INTEGER CHECK (street_count IS NULL OR street_count >= 0);

CREATE INDEX IF NOT EXISTS idx_local_bodies_taluk ON local_bodies(taluk_id);
CREATE INDEX IF NOT EXISTS idx_wards_lb ON wards(local_body_id);
CREATE INDEX IF NOT EXISTS idx_citizens_lb ON citizens(local_body_id);

-- ---------------------------------------------------------------------------
-- MULTI-PERSON ASSIGNMENT
-- ---------------------------------------------------------------------------
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS assignee_role TEXT NOT NULL DEFAULT 'PRIMARY';
DO $$ BEGIN
  ALTER TABLE assignments ADD CONSTRAINT assignments_role_chk CHECK (assignee_role IN ('PRIMARY','SUPPORT'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- COMPLAINT ACTIONS (work items inside a complaint)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS complaint_actions (
  id             BIGSERIAL PRIMARY KEY,
  complaint_id   BIGINT NOT NULL REFERENCES complaints(id),
  title          TEXT NOT NULL,
  description    TEXT,
  department_id  INTEGER REFERENCES departments(id),
  priority       TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  due_at         TIMESTAMPTZ,
  status         TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ASSIGNED','IN_PROGRESS','COMPLETED','VERIFIED','CANCELLED')),
  notes          TEXT,
  created_by     UUID NOT NULL REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     UUID REFERENCES users(id),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at   TIMESTAMPTZ,
  verified_by    UUID REFERENCES users(id),
  verified_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_actions_complaint ON complaint_actions(complaint_id);
CREATE INDEX IF NOT EXISTS idx_actions_status ON complaint_actions(status);

CREATE TABLE IF NOT EXISTS complaint_action_assignees (
  id            BIGSERIAL PRIMARY KEY,
  action_id     BIGINT NOT NULL REFERENCES complaint_actions(id),
  user_id       UUID NOT NULL REFERENCES users(id),
  assignee_role TEXT NOT NULL DEFAULT 'PRIMARY' CHECK (assignee_role IN ('PRIMARY','SUPPORT')),
  assigned_by   UUID NOT NULL REFERENCES users(id),
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_by    UUID REFERENCES users(id),
  removed_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_caa_action ON complaint_action_assignees(action_id);
CREATE INDEX IF NOT EXISTS idx_caa_user ON complaint_action_assignees(user_id) WHERE removed_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_caa_active ON complaint_action_assignees(action_id, user_id) WHERE removed_at IS NULL;

-- Append-only log of every change to an action
CREATE TABLE IF NOT EXISTS complaint_action_updates (
  id           BIGSERIAL PRIMARY KEY,
  action_id    BIGINT NOT NULL REFERENCES complaint_actions(id),
  user_id      UUID NOT NULL REFERENCES users(id),
  from_status  TEXT,
  to_status    TEXT,
  note         TEXT,
  changes      JSONB,
  evidence_id  BIGINT REFERENCES complaint_evidence(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cau_action ON complaint_action_updates(action_id, created_at);

ALTER TABLE complaint_evidence ADD COLUMN IF NOT EXISTS action_id BIGINT REFERENCES complaint_actions(id);
ALTER TABLE complaint_evidence DROP CONSTRAINT IF EXISTS complaint_evidence_kind_check;
DO $$ BEGIN
  ALTER TABLE complaint_evidence ADD CONSTRAINT complaint_evidence_kind_check CHECK (kind IN ('CITIZEN','INSPECTION','PROGRESS','COMPLETION','APPEAL','ACTION'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- WARD MAPS (GeoJSON features; one row per drawn feature)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ward_maps (
  id             BIGSERIAL PRIMARY KEY,
  ward_id        INTEGER NOT NULL REFERENCES wards(id),
  local_body_id  INTEGER NOT NULL REFERENCES local_bodies(id),
  feature_type   TEXT NOT NULL CHECK (feature_type IN ('BOUNDARY','STREET','DRAINAGE','STREETLIGHT','WORK_ZONE','PUBLIC_ASSET','PROBLEM_ZONE','OTHER')),
  geometry_type  TEXT NOT NULL CHECK (geometry_type IN ('Polygon','LineString','Point','Circle')),
  geometry       JSONB NOT NULL,          -- GeoJSON geometry (RFC 7946, [lng, lat]); circles are a Point + radius_m
  radius_m       DOUBLE PRECISION,
  name           TEXT,
  description    TEXT,
  properties     JSONB NOT NULL DEFAULT '{}',
  min_lat        DOUBLE PRECISION, min_lng DOUBLE PRECISION, max_lat DOUBLE PRECISION, max_lng DOUBLE PRECISION,
  status         TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_by     UUID NOT NULL REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     UUID REFERENCES users(id),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ward_maps_ward ON ward_maps(ward_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_ward_maps_lb ON ward_maps(local_body_id);

-- ---------------------------------------------------------------------------
-- BULK USER IMPORTS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bulk_imports (
  id            BIGSERIAL PRIMARY KEY,
  kind          TEXT NOT NULL DEFAULT 'USERS',
  file_name     TEXT,
  file_format   TEXT NOT NULL CHECK (file_format IN ('CSV','XLSX')),
  mode          TEXT NOT NULL CHECK (mode IN ('VALIDATE','ALL_OR_NOTHING','VALID_ONLY')),
  total_rows    INTEGER NOT NULL,
  created_count INTEGER NOT NULL DEFAULT 0,
  failed_count  INTEGER NOT NULL DEFAULT 0,
  errors        JSONB NOT NULL DEFAULT '[]',
  created_by    UUID NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- AUDIT: reason column; SECURITY LOG kept separate from the business audit
-- ---------------------------------------------------------------------------
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS reason TEXT;
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_logs(target_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);

CREATE TABLE IF NOT EXISTS security_logs (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES users(id),
  identifier  TEXT,              -- username / mobile attempted (never the password)
  event       TEXT NOT NULL,     -- LOGIN_SUCCESS | LOGIN_FAILED | LOGIN_LOCKED | LOGIN_BLOCKED | LOGOUT | PASSWORD_CHANGE_REQUIRED
  portal      TEXT,
  ip_address  TEXT,
  user_agent  TEXT,
  detail      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_security_logs_created ON security_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_logs_user ON security_logs(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION security_logs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'security_logs is append-only';
END; $$ LANGUAGE plpgsql SET search_path = '';
DROP TRIGGER IF EXISTS trg_security_logs_immutable ON security_logs;
CREATE TRIGGER trg_security_logs_immutable BEFORE UPDATE OR DELETE ON security_logs
  FOR EACH ROW EXECUTE FUNCTION security_logs_immutable();

CREATE OR REPLACE FUNCTION action_updates_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'complaint_action_updates is append-only';
END; $$ LANGUAGE plpgsql SET search_path = '';
DROP TRIGGER IF EXISTS trg_action_updates_immutable ON complaint_action_updates;
CREATE TRIGGER trg_action_updates_immutable BEFORE UPDATE OR DELETE ON complaint_action_updates
  FOR EACH ROW EXECUTE FUNCTION action_updates_immutable();

-- ---------------------------------------------------------------------------
-- Backfill: role history + primary jurisdictions for existing accounts
-- ---------------------------------------------------------------------------
INSERT INTO user_roles (user_id, role_id, assigned_by, assigned_at)
SELECT u.id, u.role_id, u.created_by, u.created_at FROM users u
WHERE NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id);

INSERT INTO user_jurisdictions (user_id, state_id, district_id, taluk_id, local_body_id, ward_id, department_id, is_primary, granted_by, created_at)
SELECT o.user_id, d.state_id, lb.district_id, lb.taluk_id, o.local_body_id, o.ward_id, o.department_id, true, u.created_by, u.created_at
FROM officials o JOIN users u ON u.id = o.user_id
LEFT JOIN local_bodies lb ON lb.id = o.local_body_id LEFT JOIN districts d ON d.id = lb.district_id
WHERE o.local_body_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM user_jurisdictions j WHERE j.user_id = o.user_id AND j.is_primary AND j.revoked_at IS NULL);

UPDATE local_bodies lb SET responsible_officer_id = x.user_id
FROM (SELECT DISTINCT ON (o.local_body_id) o.local_body_id, o.user_id FROM officials o JOIN users u ON u.id = o.user_id JOIN roles r ON r.id = u.role_id
      WHERE r.code = 'EO' AND u.status = 'ACTIVE' ORDER BY o.local_body_id, u.created_at) x
WHERE x.local_body_id = lb.id AND lb.responsible_officer_id IS NULL;

-- ---------------------------------------------------------------------------
-- RLS on the new tables (no policies: the Supabase REST API gets nothing) and
-- grants for the dedicated application role when it exists.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['user_roles','user_permissions','user_jurisdictions','complaint_actions','complaint_action_assignees',
                           'complaint_action_updates','ward_maps','bulk_imports','security_logs'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nambaooru_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON user_roles, user_permissions, user_jurisdictions, complaint_actions, complaint_action_assignees, ward_maps, bulk_imports TO nambaooru_app';
    EXECUTE 'GRANT SELECT, INSERT ON complaint_action_updates, security_logs TO nambaooru_app';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO nambaooru_app';
  END IF;
END $$;
