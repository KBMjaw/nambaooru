-- ============================================================================
-- Namma Ooru — Civic Complaint & Resolution Portal
-- Relational schema (PostgreSQL 14+). Idempotent: safe to re-run.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- LOCATION MASTER DATA
-- State → District → Taluk / Block → Local Body (typed) → Ward → Street
-- Postal data (pincode / post office / place) is kept separate and linked by
-- many-to-many mapping tables, because one pincode ≠ one local body / ward.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS data_sources (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT,
  reference_url TEXT,
  file_name     TEXT,
  row_count     INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  imported_by   UUID,
  imported_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS states (
  id        SERIAL PRIMARY KEY,
  code      TEXT NOT NULL UNIQUE,
  name_en   TEXT NOT NULL,
  name_ta   TEXT,
  status    TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE'))
);

CREATE TABLE IF NOT EXISTS districts (
  id        SERIAL PRIMARY KEY,
  state_id  INTEGER NOT NULL REFERENCES states(id),
  code      TEXT NOT NULL UNIQUE,
  name_en   TEXT NOT NULL,
  name_ta   TEXT,
  aliases   TEXT[] NOT NULL DEFAULT '{}',
  status    TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  UNIQUE (state_id, name_en)
);

CREATE TABLE IF NOT EXISTS taluks (
  id          SERIAL PRIMARY KEY,
  district_id INTEGER NOT NULL REFERENCES districts(id),
  name_en     TEXT NOT NULL,
  name_ta     TEXT,
  status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  UNIQUE (district_id, name_en)
);
CREATE INDEX IF NOT EXISTS idx_taluks_district ON taluks(district_id);

CREATE TABLE IF NOT EXISTS blocks (
  id          SERIAL PRIMARY KEY,
  district_id INTEGER NOT NULL REFERENCES districts(id),
  name_en     TEXT NOT NULL,
  name_ta     TEXT,
  status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  UNIQUE (district_id, name_en)
);

CREATE TABLE IF NOT EXISTS local_body_types (
  id        SERIAL PRIMARY KEY,
  code      TEXT NOT NULL UNIQUE,          -- CORPORATION | MUNICIPALITY | TOWN_PANCHAYAT | VILLAGE_PANCHAYAT
  category  TEXT NOT NULL CHECK (category IN ('URBAN','RURAL')),
  name_en   TEXT NOT NULL,
  name_ta   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_bodies (
  id           SERIAL PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,
  type_id      INTEGER NOT NULL REFERENCES local_body_types(id),
  district_id  INTEGER NOT NULL REFERENCES districts(id),
  taluk_id     INTEGER REFERENCES taluks(id),
  block_id     INTEGER REFERENCES blocks(id),
  name_en      TEXT NOT NULL,
  name_ta      TEXT,
  center_lat   DOUBLE PRECISION,
  center_lng   DOUBLE PRECISION,
  status       TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_local_bodies_district ON local_bodies(district_id);

-- Village panchayats are local bodies of type VILLAGE_PANCHAYAT.
CREATE OR REPLACE VIEW village_panchayats AS
  SELECT lb.* FROM local_bodies lb
  JOIN local_body_types t ON t.id = lb.type_id
  WHERE t.code = 'VILLAGE_PANCHAYAT';

CREATE TABLE IF NOT EXISTS wards (
  id             SERIAL PRIMARY KEY,
  local_body_id  INTEGER NOT NULL REFERENCES local_bodies(id),
  ward_number    INTEGER NOT NULL,
  name_en        TEXT,
  name_ta        TEXT,
  center_lat     DOUBLE PRECISION,
  center_lng     DOUBLE PRECISION,
  status         TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  UNIQUE (local_body_id, ward_number)
);

CREATE TABLE IF NOT EXISTS streets (
  id        SERIAL PRIMARY KEY,
  ward_id   INTEGER NOT NULL REFERENCES wards(id),
  name_en   TEXT NOT NULL,
  name_ta   TEXT,
  status    TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  UNIQUE (ward_id, name_en)
);
CREATE INDEX IF NOT EXISTS idx_streets_ward ON streets(ward_id);

CREATE TABLE IF NOT EXISTS pincodes (
  pincode   CHAR(6) PRIMARY KEY CHECK (pincode ~ '^[1-9][0-9]{5}$'),
  state_id  INTEGER REFERENCES states(id),
  status    TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE'))
);

CREATE TABLE IF NOT EXISTS post_offices (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  pincode     CHAR(6) NOT NULL REFERENCES pincodes(pincode),
  district_id INTEGER REFERENCES districts(id),
  taluk_id    INTEGER REFERENCES taluks(id),
  office_type TEXT,
  source_id   BIGINT REFERENCES data_sources(id),
  status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  UNIQUE (name, pincode)
);

-- Raw-but-normalized postal master: original Place / Pincode / District values
-- are preserved verbatim. Different place names sharing a pincode are separate rows.
CREATE TABLE IF NOT EXISTS postal_locations (
  id             BIGSERIAL PRIMARY KEY,
  place_name     TEXT NOT NULL,
  pincode        CHAR(6) NOT NULL REFERENCES pincodes(pincode),
  district_name  TEXT NOT NULL,              -- original district text from source
  district_id    INTEGER REFERENCES districts(id), -- normalized link (nullable)
  taluk_id       INTEGER REFERENCES taluks(id),
  source_id      BIGINT REFERENCES data_sources(id),
  status         TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (place_name, pincode, district_name)
);
CREATE INDEX IF NOT EXISTS idx_postal_pincode ON postal_locations(pincode);
CREATE INDEX IF NOT EXISTS idx_postal_district ON postal_locations(district_id);
CREATE INDEX IF NOT EXISTS idx_postal_place_lower ON postal_locations(lower(place_name));

-- Many-to-many: a postal place may map to several local bodies / wards and vice versa.
CREATE TABLE IF NOT EXISTS postal_location_jurisdictions (
  id                  BIGSERIAL PRIMARY KEY,
  postal_location_id  BIGINT NOT NULL REFERENCES postal_locations(id),
  local_body_id       INTEGER NOT NULL REFERENCES local_bodies(id),
  ward_id             INTEGER REFERENCES wards(id),
  confidence          TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK (confidence IN ('VERIFIED','PROBABLE','UNVERIFIED')),
  status              TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_by          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_plj ON postal_location_jurisdictions(postal_location_id, local_body_id, COALESCE(ward_id, 0));
CREATE INDEX IF NOT EXISTS idx_plj_lb ON postal_location_jurisdictions(local_body_id);

-- ---------------------------------------------------------------------------
-- USERS, ROLES, PERMISSIONS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS roles (
  id        SERIAL PRIMARY KEY,
  code      TEXT NOT NULL UNIQUE,  -- SUPER_ADMIN | SYSTEM_ADMIN | EO | SUPERVISOR | DEPT_OFFICER | FIELD_STAFF | WARD_MEMBER | CITIZEN
  name_en   TEXT NOT NULL,
  name_ta   TEXT NOT NULL,
  portal    TEXT NOT NULL CHECK (portal IN ('PUBLIC','OFFICE','ADMIN')),
  rank      INTEGER NOT NULL,      -- higher = more authority (hierarchy guard)
  is_system BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS permissions (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  is_security BOOLEAN NOT NULL DEFAULT false  -- only SUPER_ADMIN may grant these
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       INTEGER NOT NULL REFERENCES roles(id),
  permission_id INTEGER NOT NULL REFERENCES permissions(id),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS departments (
  id            SERIAL PRIMARY KEY,
  code          TEXT NOT NULL,
  local_body_id INTEGER REFERENCES local_bodies(id),  -- NULL = system-wide template
  name_en       TEXT NOT NULL,
  name_ta       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  UNIQUE (code, local_body_id)
);

CREATE TABLE IF NOT EXISTS users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username            TEXT NOT NULL UNIQUE,
  password_hash       TEXT NOT NULL,
  full_name           TEXT NOT NULL,
  mobile              TEXT NOT NULL CHECK (mobile ~ '^[6-9][0-9]{9}$'),
  email               TEXT,
  role_id             INTEGER NOT NULL REFERENCES roles(id),
  status              TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','LOCKED')),
  preferred_language  TEXT NOT NULL DEFAULT 'ta',
  profile_photo       TEXT,
  token_version       INTEGER NOT NULL DEFAULT 0,  -- bump to revoke all sessions
  failed_logins       INTEGER NOT NULL DEFAULT 0,
  locked_until        TIMESTAMPTZ,
  last_login_at       TIMESTAMPTZ,
  created_by          UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deactivated_at      TIMESTAMPTZ,
  deactivated_by      UUID REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role_id);
-- Citizens log in with mobile number: unique among citizens.
CREATE INDEX IF NOT EXISTS idx_users_mobile ON users(mobile);

CREATE TABLE IF NOT EXISTS citizens (
  user_id            UUID PRIMARY KEY REFERENCES users(id),
  dob_enc            TEXT NOT NULL,           -- AES-256-GCM encrypted
  address_enc        TEXT NOT NULL,           -- door no / house address, encrypted
  landmark           TEXT,
  pincode            CHAR(6) REFERENCES pincodes(pincode),
  postal_location_id BIGINT REFERENCES postal_locations(id),
  district_id        INTEGER REFERENCES districts(id),
  taluk_id           INTEGER REFERENCES taluks(id),
  local_body_id      INTEGER REFERENCES local_bodies(id),
  ward_id            INTEGER REFERENCES wards(id),
  street_id          INTEGER REFERENCES streets(id),
  street_text        TEXT,
  identity_verified  BOOLEAN NOT NULL DEFAULT false,  -- future Aadhaar/eKYC module (no Aadhaar number stored)
  identity_method    TEXT,
  consent_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_citizens_ward ON citizens(ward_id);

CREATE TABLE IF NOT EXISTS officials (
  user_id        UUID PRIMARY KEY REFERENCES users(id),
  designation    TEXT,
  employee_id    TEXT,
  department_id  INTEGER REFERENCES departments(id),
  local_body_id  INTEGER REFERENCES local_bodies(id),  -- NULL only for SUPER_ADMIN / SYSTEM_ADMIN
  ward_id        INTEGER REFERENCES wards(id),         -- ward member / field staff area
  supervisor_id  UUID REFERENCES users(id),
  jurisdiction   TEXT
);
CREATE INDEX IF NOT EXISTS idx_officials_lb ON officials(local_body_id);
CREATE INDEX IF NOT EXISTS idx_officials_dept ON officials(department_id);

-- ---------------------------------------------------------------------------
-- COMPLAINT CONFIGURATION
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS complaint_categories (
  id                   SERIAL PRIMARY KEY,
  code                 TEXT NOT NULL UNIQUE,
  name_en              TEXT NOT NULL,
  name_ta              TEXT NOT NULL,
  icon                 TEXT NOT NULL DEFAULT '📌',
  default_department   TEXT NOT NULL,          -- department code
  evidence_required    BOOLEAN NOT NULL DEFAULT true,
  evidence_types       TEXT[] NOT NULL DEFAULT '{photo}',
  inspection_required  BOOLEAN NOT NULL DEFAULT true,
  default_priority     TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (default_priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  keywords             TEXT[] NOT NULL DEFAULT '{}', -- admin-extendable NLP keywords
  sort_order           INTEGER NOT NULL DEFAULT 100,
  status               TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE'))
);

CREATE TABLE IF NOT EXISTS sla_rules (
  id                 SERIAL PRIMARY KEY,
  category_id        INTEGER REFERENCES complaint_categories(id),  -- NULL = default
  priority           TEXT NOT NULL CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  local_body_id      INTEGER REFERENCES local_bodies(id),          -- NULL = all
  inspection_hours   INTEGER NOT NULL DEFAULT 48,
  resolution_hours   INTEGER NOT NULL,
  warn_before_hours  INTEGER NOT NULL DEFAULT 12,
  status             TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sla ON sla_rules(COALESCE(category_id,0), priority, COALESCE(local_body_id,0));

-- Configurable routing: (local body, category[, ward]) → department (+ default officer)
CREATE TABLE IF NOT EXISTS routing_rules (
  id              SERIAL PRIMARY KEY,
  local_body_id   INTEGER NOT NULL REFERENCES local_bodies(id),
  category_id     INTEGER NOT NULL REFERENCES complaint_categories(id),
  ward_id         INTEGER REFERENCES wards(id),
  department_id   INTEGER NOT NULL REFERENCES departments(id),
  default_officer_id UUID REFERENCES users(id),
  status          TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_routing ON routing_rules(local_body_id, category_id, COALESCE(ward_id,0));

-- ---------------------------------------------------------------------------
-- COMPLAINTS & WORKFLOW
-- ---------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS complaint_code_seq START 1001;

CREATE TABLE IF NOT EXISTS complaints (
  id                   BIGSERIAL PRIMARY KEY,
  code                 TEXT NOT NULL UNIQUE,
  citizen_id           UUID NOT NULL REFERENCES users(id),
  category_id          INTEGER REFERENCES complaint_categories(id),
  department_id        INTEGER REFERENCES departments(id),
  local_body_id        INTEGER NOT NULL REFERENCES local_bodies(id),
  ward_id              INTEGER REFERENCES wards(id),
  street_id            INTEGER REFERENCES streets(id),
  street_text          TEXT,
  landmark             TEXT,
  pincode              CHAR(6),
  district_id          INTEGER REFERENCES districts(id),
  location_snapshot    JSONB NOT NULL DEFAULT '{}',   -- preserved names at time of filing
  citizen_address_snapshot JSONB NOT NULL DEFAULT '{}',
  latitude             DOUBLE PRECISION,
  longitude            DOUBLE PRECISION,
  gps_accuracy_m       DOUBLE PRECISION,
  gps_captured_at      TIMESTAMPTZ,
  location_conflict    BOOLEAN NOT NULL DEFAULT false,
  location_conflict_note TEXT,
  original_text        TEXT NOT NULL,                  -- citizen's exact words / transcript
  input_mode           TEXT NOT NULL DEFAULT 'TEXT' CHECK (input_mode IN ('TEXT','VOICE')),
  detected_language    TEXT,
  title_en             TEXT,
  title_ta             TEXT,
  summary_en           TEXT,
  summary_ta           TEXT,
  ai_extraction        JSONB NOT NULL DEFAULT '{}',
  ai_engine            TEXT,
  severity             TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  priority             TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  safety_risk          BOOLEAN NOT NULL DEFAULT false,
  duration_text        TEXT,
  status               TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN (
                         'DRAFT','SUBMITTED','AI_CLASSIFIED','INITIAL_REVIEW','SITE_INSPECTION',
                         'VERIFIED','REJECTED','DUPLICATE','ASSIGNED','IN_PROGRESS',
                         'WORK_COMPLETED','COMPLETION_VERIFIED','CLOSED','REOPENED')),
  inspection_outcome   TEXT,
  rejection_reason     TEXT CHECK (rejection_reason IS NULL OR rejection_reason IN (
                         'DUPLICATE','NOT_FOUND','OUTSIDE_JURISDICTION','INSUFFICIENT_EVIDENCE',
                         'ALREADY_RESOLVED','INVALID','OTHER')),
  rejection_notes      TEXT,
  duplicate_of_id      BIGINT REFERENCES complaints(id),
  possible_duplicate_of_id BIGINT REFERENCES complaints(id),
  duplicate_override   BOOLEAN NOT NULL DEFAULT false,
  escalated            BOOLEAN NOT NULL DEFAULT false,
  escalation_note      TEXT,
  assigned_to          UUID REFERENCES users(id),
  inspector_id         UUID REFERENCES users(id),
  sla_due_at           TIMESTAMPTZ,
  sla_warned_at        TIMESTAMPTZ,
  sla_breached_at      TIMESTAMPTZ,
  supporters_count     INTEGER NOT NULL DEFAULT 0,
  submitted_at         TIMESTAMPTZ,
  work_started_at      TIMESTAMPTZ,
  work_completed_at    TIMESTAMPTZ,
  closed_at            TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_complaints_citizen ON complaints(citizen_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_complaints_lb_status ON complaints(local_body_id, status);
CREATE INDEX IF NOT EXISTS idx_complaints_ward ON complaints(ward_id, status);
CREATE INDEX IF NOT EXISTS idx_complaints_category ON complaints(category_id, status);
CREATE INDEX IF NOT EXISTS idx_complaints_dept ON complaints(department_id, status);
CREATE INDEX IF NOT EXISTS idx_complaints_assigned ON complaints(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_complaints_sla ON complaints(sla_due_at) WHERE status NOT IN ('CLOSED','REJECTED','DUPLICATE');
CREATE INDEX IF NOT EXISTS idx_complaints_geo ON complaints(latitude, longitude);

-- Citizens who confirm "same issue" on an existing complaint instead of filing a duplicate
CREATE TABLE IF NOT EXISTS complaint_supporters (
  complaint_id BIGINT NOT NULL REFERENCES complaints(id),
  user_id      UUID NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (complaint_id, user_id)
);

CREATE TABLE IF NOT EXISTS complaint_evidence (
  id              BIGSERIAL PRIMARY KEY,
  complaint_id    BIGINT NOT NULL REFERENCES complaints(id),
  kind            TEXT NOT NULL CHECK (kind IN ('CITIZEN','INSPECTION','PROGRESS','COMPLETION','APPEAL')),
  media_type      TEXT NOT NULL CHECK (media_type IN ('PHOTO','VIDEO')),
  mime_type       TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  sha256          TEXT NOT NULL,
  image_hash      TEXT,         -- 64-bit perceptual (average) hash, hex — duplicate detection
  data            BYTEA NOT NULL,
  latitude        DOUBLE PRECISION,
  longitude       DOUBLE PRECISION,
  gps_accuracy_m  DOUBLE PRECISION,
  captured_at     TIMESTAMPTZ,
  capture_source  TEXT CHECK (capture_source IN ('CAMERA','UPLOAD')),
  uploaded_by     UUID NOT NULL REFERENCES users(id),
  appeal_id       BIGINT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_evidence_complaint ON complaint_evidence(complaint_id, kind);

CREATE TABLE IF NOT EXISTS complaint_status_history (
  id            BIGSERIAL PRIMARY KEY,
  complaint_id  BIGINT NOT NULL REFERENCES complaints(id),
  from_status   TEXT,
  to_status     TEXT NOT NULL,
  actor_id      UUID REFERENCES users(id),   -- NULL = SYSTEM / AI
  actor_label   TEXT,
  note          TEXT,
  public_note   BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_csh_complaint ON complaint_status_history(complaint_id, created_at);

CREATE TABLE IF NOT EXISTS inspections (
  id             BIGSERIAL PRIMARY KEY,
  complaint_id   BIGINT NOT NULL REFERENCES complaints(id),
  inspector_id   UUID NOT NULL REFERENCES users(id),
  outcome        TEXT NOT NULL CHECK (outcome IN ('VERIFIED','NOT_FOUND','DUPLICATE','ALREADY_RESOLVED','INVALID','REQUIRES_HIGHER_AUTHORITY')),
  notes          TEXT NOT NULL,
  latitude       DOUBLE PRECISION,
  longitude      DOUBLE PRECISION,
  gps_accuracy_m DOUBLE PRECISION,
  evidence_id    BIGINT REFERENCES complaint_evidence(id),
  inspected_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inspections_complaint ON inspections(complaint_id);

CREATE TABLE IF NOT EXISTS assignments (
  id             BIGSERIAL PRIMARY KEY,
  complaint_id   BIGINT NOT NULL REFERENCES complaints(id),
  assigned_to    UUID NOT NULL REFERENCES users(id),
  assigned_by    UUID NOT NULL REFERENCES users(id),
  department_id  INTEGER REFERENCES departments(id),
  purpose        TEXT NOT NULL DEFAULT 'WORK' CHECK (purpose IN ('WORK','INSPECTION')),
  status         TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','IN_PROGRESS','COMPLETED','REASSIGNED','CANCELLED')),
  priority       TEXT NOT NULL DEFAULT 'MEDIUM',
  due_at         TIMESTAMPTZ,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at    TIMESTAMPTZ,
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_assignments_user ON assignments(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_assignments_complaint ON assignments(complaint_id);

CREATE TABLE IF NOT EXISTS work_updates (
  id             BIGSERIAL PRIMARY KEY,
  complaint_id   BIGINT NOT NULL REFERENCES complaints(id),
  assignment_id  BIGINT REFERENCES assignments(id),
  user_id        UUID NOT NULL REFERENCES users(id),
  update_type    TEXT NOT NULL CHECK (update_type IN ('ACCEPTED','STARTED','PROGRESS','COMPLETED','SENT_BACK')),
  notes          TEXT,
  progress_pct   INTEGER CHECK (progress_pct BETWEEN 0 AND 100),
  evidence_id    BIGINT REFERENCES complaint_evidence(id),
  latitude       DOUBLE PRECISION,
  longitude      DOUBLE PRECISION,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_work_updates_complaint ON work_updates(complaint_id, created_at);

CREATE TABLE IF NOT EXISTS completion_evidence (
  id                  BIGSERIAL PRIMARY KEY,
  complaint_id        BIGINT NOT NULL REFERENCES complaints(id),
  assignment_id       BIGINT REFERENCES assignments(id),
  evidence_id         BIGINT NOT NULL REFERENCES complaint_evidence(id),
  notes               TEXT NOT NULL,
  latitude            DOUBLE PRECISION NOT NULL,
  longitude           DOUBLE PRECISION NOT NULL,
  gps_accuracy_m      DOUBLE PRECISION,
  completed_by        UUID NOT NULL REFERENCES users(id),
  completed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  verification_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING','APPROVED','SENT_BACK')),
  verified_by         UUID REFERENCES users(id),
  verified_at         TIMESTAMPTZ,
  verification_notes  TEXT
);
CREATE INDEX IF NOT EXISTS idx_completion_complaint ON completion_evidence(complaint_id);

CREATE TABLE IF NOT EXISTS appeals (
  id              BIGSERIAL PRIMARY KEY,
  complaint_id    BIGINT NOT NULL REFERENCES complaints(id),
  citizen_id      UUID NOT NULL REFERENCES users(id),
  reason_text     TEXT NOT NULL,
  input_mode      TEXT NOT NULL DEFAULT 'TEXT' CHECK (input_mode IN ('TEXT','VOICE')),
  status_at_appeal TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','REJECTED')),
  reviewer_id     UUID REFERENCES users(id),
  decision_notes  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_appeals_complaint ON appeals(complaint_id);
CREATE INDEX IF NOT EXISTS idx_appeals_status ON appeals(status);

-- ---------------------------------------------------------------------------
-- NOTIFICATIONS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notification_templates (
  id        SERIAL PRIMARY KEY,
  code      TEXT NOT NULL UNIQUE,
  title_en  TEXT NOT NULL,
  title_ta  TEXT NOT NULL,
  body_en   TEXT NOT NULL,
  body_ta   TEXT NOT NULL,
  channels  TEXT[] NOT NULL DEFAULT '{IN_APP}',  -- IN_APP | SMS | WHATSAPP | EMAIL | PUSH
  active    BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id),
  complaint_id  BIGINT REFERENCES complaints(id),
  template_code TEXT,
  title_en      TEXT NOT NULL,
  title_ta      TEXT NOT NULL,
  body_en       TEXT NOT NULL,
  body_ta       TEXT NOT NULL,
  channel       TEXT NOT NULL DEFAULT 'IN_APP',
  delivery_status TEXT NOT NULL DEFAULT 'DELIVERED' CHECK (delivery_status IN ('QUEUED','DELIVERED','FAILED')),
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- AUDIT LOG (append-only — UPDATE/DELETE blocked by trigger)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_logs (
  id              BIGSERIAL PRIMARY KEY,
  actor_id        UUID REFERENCES users(id),
  actor_role      TEXT,
  action          TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       TEXT,
  target_user_id  UUID REFERENCES users(id),
  old_value       JSONB,
  new_value       JSONB,
  ip_address      TEXT,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id);

CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END; $$ LANGUAGE plpgsql SET search_path = '';

DROP TRIGGER IF EXISTS trg_audit_immutable ON audit_logs;
CREATE TRIGGER trg_audit_immutable BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

CREATE OR REPLACE FUNCTION status_history_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'complaint_status_history is append-only';
END; $$ LANGUAGE plpgsql SET search_path = '';

DROP TRIGGER IF EXISTS trg_csh_immutable ON complaint_status_history;
CREATE TRIGGER trg_csh_immutable BEFORE UPDATE OR DELETE ON complaint_status_history
  FOR EACH ROW EXECUTE FUNCTION status_history_immutable();

-- ---------------------------------------------------------------------------
-- SYSTEM
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS system_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  is_security BOOLEAN NOT NULL DEFAULT false,
  updated_by  UUID REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS languages (
  code        TEXT PRIMARY KEY,
  name_en     TEXT NOT NULL,
  native_name TEXT NOT NULL,
  short_label TEXT NOT NULL,
  speech_locale TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  sort_order  INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket       TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  hits         INTEGER NOT NULL
);

-- Deny direct access through Supabase's auto-generated REST API; the app
-- connects with its own role and enforces authorization server-side.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

-- Optional: dedicated application login role (run as the database owner; see README)
-- CREATE ROLE nambaooru_app LOGIN PASSWORD '...' BYPASSRLS;
-- GRANT USAGE ON SCHEMA public TO nambaooru_app;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nambaooru_app;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO nambaooru_app;
-- REVOKE UPDATE, DELETE ON audit_logs, complaint_status_history FROM nambaooru_app;
