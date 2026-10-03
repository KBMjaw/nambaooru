-- 008: Workflow action log (every official action on a complaint, with an action code, type, description,
-- actor, status change and linked evidence) and explicit AFTER / ACTION_REFERENCE evidence kinds.
-- Additive only: no existing rows are changed.

CREATE TABLE IF NOT EXISTS complaint_action_log (
  id            BIGSERIAL PRIMARY KEY,
  code          TEXT GENERATED ALWAYS AS ('ACT-' || lpad(id::text, 6, '0')) STORED,
  complaint_id  BIGINT NOT NULL REFERENCES complaints(id),
  action_type   TEXT NOT NULL CHECK (length(action_type) BETWEEN 2 AND 40),
  description   TEXT,
  visibility    TEXT NOT NULL DEFAULT 'INTERNAL' CHECK (visibility IN ('PUBLIC','INTERNAL')),
  actor_id      UUID NOT NULL REFERENCES users(id),
  actor_role    TEXT,
  from_status   TEXT NOT NULL,
  to_status     TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_action_log_complaint ON complaint_action_log(complaint_id, created_at);

-- The log is append-only, like the audit log
CREATE OR REPLACE FUNCTION action_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'complaint_action_log is append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_action_log_immutable ON complaint_action_log;
CREATE TRIGGER trg_action_log_immutable BEFORE UPDATE OR DELETE ON complaint_action_log
  FOR EACH ROW EXECUTE FUNCTION action_log_immutable();

ALTER TABLE complaint_evidence ADD COLUMN IF NOT EXISTS workflow_action_id BIGINT REFERENCES complaint_action_log(id);
CREATE INDEX IF NOT EXISTS idx_evidence_workflow_action ON complaint_evidence(workflow_action_id) WHERE workflow_action_id IS NOT NULL;

ALTER TABLE complaint_evidence DROP CONSTRAINT IF EXISTS complaint_evidence_kind_check;
ALTER TABLE complaint_evidence ADD CONSTRAINT complaint_evidence_kind_check CHECK (kind IN (
  'CITIZEN','INSPECTION','PROGRESS','COMPLETION','APPEAL','ACTION','BEFORE_WORK','VERIFICATION','AFTER','ACTION_REFERENCE'));

-- Same protection as every other table (migrations 002–006): row-level security on with no policies, so the
-- Supabase API roles (anon / authenticated) get nothing; the application role reads and appends to the log.
DO $$
BEGIN
  ALTER TABLE public.complaint_action_log ENABLE ROW LEVEL SECURITY;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nambaooru_app') THEN
    EXECUTE 'GRANT SELECT, INSERT ON complaint_action_log TO nambaooru_app';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE complaint_action_log_id_seq TO nambaooru_app';
  END IF;
END $$;
