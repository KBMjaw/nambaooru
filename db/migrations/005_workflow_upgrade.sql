-- Namma Ooru: complaint workflow upgrade (migration 005, idempotent)
--   * issue types (sub-categories) under each category, admin-managed
--   * suggested vs. assigned department with who/when
--   * ON_HOLD, VERIFICATION_PENDING and REWORK_REQUIRED statuses
--   * resolution type on every finished complaint (Resolved, No issue found, Invalid, ...)
--   * escalation level (Field staff -> Supervisor -> Dept officer -> EO -> Higher authority)
--   * completion verification by evidence review (method A) or field visit (method B)
--   * supervisor assignments, before-work / verification evidence, hold / resume / no-issue work updates
-- Existing rows are kept: nothing is deleted, history rows are only appended.

-- ---------------------------------------------------------------------------
-- Issue types (sub-categories)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS complaint_issue_types (
  id                SERIAL PRIMARY KEY,
  category_id       INTEGER NOT NULL REFERENCES complaint_categories(id),
  code              TEXT NOT NULL UNIQUE,
  name_en           TEXT NOT NULL,
  name_ta           TEXT NOT NULL,
  default_priority  TEXT CHECK (default_priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  keywords          TEXT[] NOT NULL DEFAULT '{}',
  sort_order        INTEGER NOT NULL DEFAULT 100,
  status            TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE'))
);
CREATE INDEX IF NOT EXISTS complaint_issue_types_cat_idx ON complaint_issue_types (category_id);

INSERT INTO complaint_issue_types (category_id, code, name_en, name_ta, default_priority, keywords, sort_order)
SELECT c.id, v.code, v.name_en, v.name_ta, v.prio, v.kw::text[], v.ord
FROM (VALUES
  ('STREET_LIGHT', 'SL_NOT_WORKING',  'Street light not working',        'தெரு விளக்கு எரியவில்லை',            NULL,       '{not working,off,dark,eriyala,eriyavillai,எரியவில்லை,எரியல}', 10),
  ('STREET_LIGHT', 'SL_FLICKERING',   'Street light flickering',         'தெரு விளக்கு மின்னுகிறது',           'LOW',      '{flicker,blinking,minnuthu,மின்னுது,மின்னுகிறது}', 20),
  ('STREET_LIGHT', 'SL_DAYTIME',      'Street light on during daytime',  'பகலில் தெரு விளக்கு எரிகிறது',        'LOW',      '{day time,daytime,pagal,பகலில்}', 30),
  ('STREET_LIGHT', 'SL_POLE_DAMAGED', 'Electric pole damaged / leaning', 'மின் கம்பம் சேதம் / சாய்ந்துள்ளது',  'HIGH',     '{pole,leaning,kambam,கம்பம்,சாய்ந்து}', 40),
  ('STREET_LIGHT', 'SL_LOOSE_WIRE',   'Loose / hanging electric wire',   'தொங்கும் மின் கம்பி',                'CRITICAL', '{wire,hanging,loose,kambi,கம்பி,தொங்கு}', 50),
  ('STREET_LIGHT', 'SL_TRANSFORMER',  'Transformer / junction box issue','மின்மாற்றி / சந்திப்புப் பெட்டி பிரச்சினை', 'HIGH', '{transformer,junction,box,sparking,spark,தீப்பொறி}', 60),
  ('STREET_LIGHT', 'SL_NEW_LIGHT',    'New street light required',       'புதிய தெரு விளக்கு தேவை',            'LOW',      '{new light,puthu,புதிய}', 70),
  ('WATER_SUPPLY', 'WS_NO_SUPPLY',    'No water supply',                 'குடிநீர் வரவில்லை',                  NULL,       '{no water,thanni varala,வரவில்லை}', 10),
  ('WATER_SUPPLY', 'WS_LOW_PRESSURE', 'Low pressure',                    'குறைந்த அழுத்தம்',                   'LOW',      '{low pressure,pressure,அழுத்தம்}', 20),
  ('WATER_SUPPLY', 'WS_CONTAMINATED', 'Contaminated / dirty water',      'அசுத்தமான குடிநீர்',                 'HIGH',     '{dirty,contaminated,smell,கலங்கல்,அசுத்த}', 30),
  ('WATER_LEAK',   'WL_PIPE_BURST',   'Pipe burst',                      'குழாய் உடைப்பு',                     'HIGH',     '{burst,broken pipe,udainthu,உடைந்து,உடைப்பு}', 10),
  ('WATER_LEAK',   'WL_TAP_LEAK',     'Public tap leaking',              'பொதுக் குழாய் கசிவு',                'LOW',      '{tap,leak,kasivu,கசிவு}', 20),
  ('DRAINAGE',     'DR_BLOCKED',      'Drain blocked',                   'வடிகால் அடைப்பு',                    NULL,       '{block,blocked,adaippu,அடைப்பு}', 10),
  ('DRAINAGE',     'DR_OVERFLOW',     'Drain overflowing onto road',     'சாலையில் கழிவுநீர் வழிகிறது',         'HIGH',     '{overflow,road,vazhiyuthu,வழிகிறது}', 20),
  ('GARBAGE',      'GB_NOT_COLLECTED','Garbage not collected',           'குப்பை அள்ளப்படவில்லை',               NULL,       '{not collected,kuppai,குப்பை}', 10),
  ('GARBAGE',      'GB_BURNING',      'Garbage burning',                 'குப்பை எரிக்கப்படுகிறது',              'HIGH',     '{burning,fire,smoke,எரிப்பு,புகை}', 20),
  ('ROAD_DAMAGE',  'RD_POTHOLE',      'Pothole',                         'சாலைக் குழி',                        NULL,       '{pothole,pallam,பள்ளம்,குழி}', 10),
  ('ROAD_DAMAGE',  'RD_DAMAGED',      'Road surface damaged',            'சாலை சேதம்',                         NULL,       '{damaged road,broken road,சேதம்}', 20)
) AS v(cat, code, name_en, name_ta, prio, kw, ord)
JOIN complaint_categories c ON c.code = v.cat
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Complaint columns
-- ---------------------------------------------------------------------------
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS issue_type_id INTEGER REFERENCES complaint_issue_types(id);
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS suggested_department_id INTEGER REFERENCES departments(id);
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS department_assigned_by UUID REFERENCES users(id);
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS department_assigned_at TIMESTAMPTZ;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS escalation_level INTEGER NOT NULL DEFAULT 0;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS on_hold_reason TEXT;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS on_hold_note TEXT;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS on_hold_since TIMESTAMPTZ;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS resolution_type TEXT;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS resolution_notes TEXT;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES users(id);
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

ALTER TABLE complaints DROP CONSTRAINT IF EXISTS complaints_status_check;
ALTER TABLE complaints ADD CONSTRAINT complaints_status_check CHECK (status IN (
  'DRAFT','SUBMITTED','AI_CLASSIFIED','INITIAL_REVIEW','SITE_INSPECTION','VERIFIED','REJECTED','DUPLICATE',
  'ASSIGNED','IN_PROGRESS','ON_HOLD','WORK_COMPLETED','VERIFICATION_PENDING','REWORK_REQUIRED','COMPLETION_VERIFIED','CLOSED','REOPENED'));

ALTER TABLE complaints DROP CONSTRAINT IF EXISTS complaints_rejection_reason_check;
ALTER TABLE complaints ADD CONSTRAINT complaints_rejection_reason_check CHECK (rejection_reason IS NULL OR rejection_reason IN (
  'DUPLICATE','NOT_FOUND','OUTSIDE_JURISDICTION','INSUFFICIENT_EVIDENCE','ALREADY_RESOLVED','INVALID','CANNOT_VERIFY','OTHER'));

ALTER TABLE complaints DROP CONSTRAINT IF EXISTS complaints_on_hold_reason_check;
ALTER TABLE complaints ADD CONSTRAINT complaints_on_hold_reason_check CHECK (on_hold_reason IS NULL OR on_hold_reason IN (
  'MATERIAL_UNAVAILABLE','WEATHER','PERMISSION_REQUIRED','EXTERNAL_AGENCY','SAFETY','OTHER'));

ALTER TABLE complaints DROP CONSTRAINT IF EXISTS complaints_resolution_type_check;
ALTER TABLE complaints ADD CONSTRAINT complaints_resolution_type_check CHECK (resolution_type IS NULL OR resolution_type IN (
  'RESOLVED','NO_ISSUE_FOUND','INVALID','DUPLICATE','OUTSIDE_JURISDICTION','INSUFFICIENT_INFORMATION','CANNOT_VERIFY','OTHER'));

ALTER TABLE complaints DROP CONSTRAINT IF EXISTS complaints_escalation_level_check;
ALTER TABLE complaints ADD CONSTRAINT complaints_escalation_level_check CHECK (escalation_level BETWEEN 0 AND 4);

CREATE INDEX IF NOT EXISTS complaints_escalation_idx ON complaints (escalation_level) WHERE escalation_level > 0;

-- ---------------------------------------------------------------------------
-- Evidence, work updates, assignments, completion verification
-- ---------------------------------------------------------------------------
ALTER TABLE complaint_evidence DROP CONSTRAINT IF EXISTS complaint_evidence_kind_check;
ALTER TABLE complaint_evidence ADD CONSTRAINT complaint_evidence_kind_check CHECK (kind IN (
  'CITIZEN','INSPECTION','PROGRESS','COMPLETION','APPEAL','ACTION','BEFORE_WORK','VERIFICATION'));

ALTER TABLE work_updates DROP CONSTRAINT IF EXISTS work_updates_update_type_check;
ALTER TABLE work_updates ADD CONSTRAINT work_updates_update_type_check CHECK (update_type IN (
  'ACCEPTED','STARTED','PROGRESS','COMPLETED','SENT_BACK','ON_HOLD','RESUMED','NO_ISSUE','NOTE'));

ALTER TABLE assignments DROP CONSTRAINT IF EXISTS assignments_role_chk;
ALTER TABLE assignments ADD CONSTRAINT assignments_role_chk CHECK (assignee_role IN ('PRIMARY','SUPPORT','SUPERVISOR'));

ALTER TABLE completion_evidence ADD COLUMN IF NOT EXISTS proposed_resolution TEXT NOT NULL DEFAULT 'RESOLVED';
ALTER TABLE completion_evidence ADD COLUMN IF NOT EXISTS verification_method TEXT;
ALTER TABLE completion_evidence ADD COLUMN IF NOT EXISTS verification_latitude DOUBLE PRECISION;
ALTER TABLE completion_evidence ADD COLUMN IF NOT EXISTS verification_longitude DOUBLE PRECISION;
ALTER TABLE completion_evidence ADD COLUMN IF NOT EXISTS verification_evidence_id BIGINT REFERENCES complaint_evidence(id);
ALTER TABLE completion_evidence DROP CONSTRAINT IF EXISTS completion_evidence_proposed_chk;
ALTER TABLE completion_evidence ADD CONSTRAINT completion_evidence_proposed_chk CHECK (proposed_resolution IN ('RESOLVED','NO_ISSUE_FOUND'));
ALTER TABLE completion_evidence DROP CONSTRAINT IF EXISTS completion_evidence_method_chk;
ALTER TABLE completion_evidence ADD CONSTRAINT completion_evidence_method_chk CHECK (verification_method IS NULL OR verification_method IN ('EVIDENCE','FIELD'));

-- ---------------------------------------------------------------------------
-- Notification templates for the new steps
-- ---------------------------------------------------------------------------
INSERT INTO notification_templates (code, title_en, title_ta, body_en, body_ta, channels) VALUES
  ('DEPARTMENT_ASSIGNED', 'Complaint routed to your department', 'உங்கள் துறைக்குப் புகார் அனுப்பப்பட்டது',
     'Complaint {code} ({category}) has been assigned to {department}.', 'புகார் {code} ({category}) {department}-க்கு ஒதுக்கப்பட்டது.', '{IN_APP}'),
  ('SUPERVISOR_ASSIGNED', 'You are supervising a complaint', 'புகார் மேற்பார்வை ஒதுக்கப்பட்டது',
     'You have been assigned as supervisor for complaint {code} ({category}).', 'புகார் {code} ({category})-க்கு நீங்கள் மேற்பார்வையாளராக நியமிக்கப்பட்டுள்ளீர்கள்.', '{IN_APP,PUSH}'),
  ('ON_HOLD', 'Work on hold', 'பணி நிறுத்தி வைக்கப்பட்டுள்ளது',
     'Work on complaint {code} is temporarily on hold: {reason}.', 'புகார் {code}-இன் பணி தற்காலிகமாக நிறுத்தப்பட்டுள்ளது: {reason}.', '{IN_APP}'),
  ('RESUMED', 'Work resumed', 'பணி மீண்டும் தொடங்கியது',
     'Work on complaint {code} has resumed.', 'புகார் {code}-இன் பணி மீண்டும் தொடங்கியது.', '{IN_APP}'),
  ('VERIFICATION_PENDING', 'Work done — verification pending', 'பணி முடிந்தது — சரிபார்ப்பு நிலுவையில்',
     'Work on complaint {code} is done and is being verified by an officer.', 'புகார் {code}-இன் பணி முடிந்தது; அலுவலர் சரிபார்க்கிறார்.', '{IN_APP}'),
  ('REWORK_REQUIRED', 'Rework required', 'மீண்டும் பணி செய்ய வேண்டும்',
     'Verification of {code} found the work incomplete: {reason}. Please redo the work.', '{code} சரிபார்ப்பில் பணி முழுமையடையவில்லை: {reason}. மீண்டும் செய்யவும்.', '{IN_APP,PUSH}'),
  ('NO_ISSUE_REPORTED', 'Field report: no issue found', 'கள அறிக்கை: பிரச்சினை காணப்படவில்லை',
     'Field staff found no issue at the site of complaint {code}. Please verify.', 'புகார் {code} இடத்தில் பிரச்சினை காணப்படவில்லை என களப் பணியாளர் தெரிவித்தார். சரிபார்க்கவும்.', '{IN_APP}'),
  ('ESCALATED_TO_YOU', 'Complaint escalated to you', 'புகார் உங்களுக்கு உயர்த்தப்பட்டது',
     'Complaint {code} has been escalated to you (level {level}): {reason}', 'புகார் {code} உங்களுக்கு உயர்த்தப்பட்டது (நிலை {level}): {reason}', '{IN_APP,PUSH}'),
  ('CLASSIFIED', 'Complaint classified', 'புகார் வகைப்படுத்தப்பட்டது',
     'Complaint {code} is classified as {category} and handled by {department}.', 'புகார் {code} {category} என வகைப்படுத்தப்பட்டு {department} கையாளுகிறது.', '{IN_APP}')
ON CONFLICT (code) DO NOTHING;

-- Citizen-facing wording now that verification is its own step
UPDATE notification_templates SET
  body_en = 'Field staff reported work completed for {code}.',
  body_ta = '{code} பணி முடிந்ததாகக் களப் பணியாளர் தெரிவித்தார்.'
WHERE code = 'WORK_COMPLETED' AND body_en LIKE '%Awaiting officer verification%';

-- ---------------------------------------------------------------------------
-- Data migration (runs once)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM system_settings WHERE key = 'migration.005_data') THEN
    -- Routing: what the system suggested is what is assigned today
    UPDATE complaints SET suggested_department_id = department_id,
                          department_assigned_at = COALESCE(department_assigned_at, submitted_at, created_at)
    WHERE suggested_department_id IS NULL AND department_id IS NOT NULL;

    -- Before this upgrade WORK_COMPLETED meant "awaiting verification": move those to the new explicit status
    INSERT INTO complaint_status_history (complaint_id, from_status, to_status, actor_id, actor_label, note, public_note)
    SELECT id, 'WORK_COMPLETED', 'VERIFICATION_PENDING', NULL, 'System',
           'Workflow upgrade: completed work is now awaiting verification as its own step', true
    FROM complaints WHERE status = 'WORK_COMPLETED';
    UPDATE complaints SET status = 'VERIFICATION_PENDING', updated_at = now() WHERE status = 'WORK_COMPLETED';

    -- Resolution type for complaints that are already finished
    UPDATE complaints SET resolution_type = CASE
        WHEN status = 'CLOSED' THEN 'RESOLVED'
        WHEN status = 'DUPLICATE' THEN 'DUPLICATE'
        WHEN rejection_reason IN ('NOT_FOUND','ALREADY_RESOLVED') THEN 'NO_ISSUE_FOUND'
        WHEN rejection_reason = 'INSUFFICIENT_EVIDENCE' THEN 'INSUFFICIENT_INFORMATION'
        WHEN rejection_reason IN ('INVALID','OUTSIDE_JURISDICTION','CANNOT_VERIFY','DUPLICATE') THEN rejection_reason
        ELSE 'OTHER' END,
      resolution_notes = COALESCE(resolution_notes, rejection_notes),
      resolved_at = COALESCE(resolved_at, closed_at, updated_at)
    WHERE status IN ('CLOSED','REJECTED','DUPLICATE') AND resolution_type IS NULL;

    -- Complaints already flagged as escalated start at level 1
    UPDATE complaints SET escalation_level = 1, escalated_at = COALESCE(escalated_at, updated_at)
    WHERE escalated AND escalation_level = 0;

    INSERT INTO system_settings (key, value, is_security) VALUES ('migration.005_data', to_jsonb(now()::text), false);
  END IF;
END $$;

DO $$
BEGIN
  ALTER TABLE public.complaint_issue_types ENABLE ROW LEVEL SECURITY;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nambaooru_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON complaint_issue_types TO nambaooru_app';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE complaint_issue_types_id_seq TO nambaooru_app';
  END IF;
END $$;
