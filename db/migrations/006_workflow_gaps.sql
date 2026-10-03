-- Namma Ooru: workflow gaps (migration 006, idempotent)
--   * sub-categories between category and issue type (Electrical → Street lighting → Street light not working)
--   * verifier assignments
--   * "request more information" from the citizen, and the citizen's reply
--   * citizen feedback on a finished complaint
--   * report export permission
-- Nothing is deleted; existing rows keep working (sub-category is optional).

CREATE TABLE IF NOT EXISTS complaint_subcategories (
  id           SERIAL PRIMARY KEY,
  category_id  INTEGER NOT NULL REFERENCES complaint_categories(id),
  code         TEXT NOT NULL UNIQUE,
  name_en      TEXT NOT NULL,
  name_ta      TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 100,
  status       TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE'))
);
CREATE INDEX IF NOT EXISTS complaint_subcategories_cat_idx ON complaint_subcategories (category_id);

INSERT INTO complaint_subcategories (category_id, code, name_en, name_ta, sort_order)
SELECT c.id, v.code, v.name_en, v.name_ta, v.ord
FROM (VALUES
  ('STREET_LIGHT', 'EL_STREET_LIGHTING', 'Street lighting',  'தெரு விளக்கு', 10),
  ('STREET_LIGHT', 'EL_POLE',            'Pole',             'மின் கம்பம்', 20),
  ('STREET_LIGHT', 'EL_WIRING',          'Wiring',           'மின் கம்பி', 30),
  ('STREET_LIGHT', 'EL_TRANSFORMER',     'Transformer',      'மின்மாற்றி', 40),
  ('STREET_LIGHT', 'EL_POWER_SUPPLY',    'Power supply / EB', 'மின் விநியோகம் / மின்வாரியம்', 50),
  ('STREET_LIGHT', 'EL_HAZARD',          'Electrical hazard', 'மின் அபாயம்', 60),
  ('STREET_LIGHT', 'EL_OTHER',           'Other electrical', 'பிற மின் பிரச்சினை', 99),
  ('WATER_SUPPLY', 'WS_SUPPLY',          'Water supply',     'குடிநீர் விநியோகம்', 10),
  ('WATER_SUPPLY', 'WS_QUALITY',         'Water quality',    'குடிநீர் தரம்', 20),
  ('WATER_LEAK',   'WL_PIPELINE',        'Pipeline',         'குழாய்', 10),
  ('DRAINAGE',     'DR_DRAIN',           'Drain',            'வடிகால்', 10),
  ('GARBAGE',      'GB_COLLECTION',      'Collection',       'குப்பை அள்ளுதல்', 10),
  ('ROAD_DAMAGE',  'RD_SURFACE',         'Road surface',     'சாலை மேற்பரப்பு', 10)
) AS v(cat, code, name_en, name_ta, ord)
JOIN complaint_categories c ON c.code = v.cat
ON CONFLICT (code) DO NOTHING;

ALTER TABLE complaint_issue_types ADD COLUMN IF NOT EXISTS subcategory_id INTEGER REFERENCES complaint_subcategories(id);
UPDATE complaint_issue_types it SET subcategory_id = s.id
FROM (VALUES
  ('SL_NOT_WORKING','EL_STREET_LIGHTING'), ('SL_DAMAGED','EL_STREET_LIGHTING'), ('SL_FLICKERING','EL_STREET_LIGHTING'),
  ('SL_DAYTIME','EL_STREET_LIGHTING'), ('SL_NEW_LIGHT','EL_STREET_LIGHTING'),
  ('SL_POLE_DAMAGED','EL_POLE'), ('SL_POLE_FALLEN','EL_POLE'),
  ('SL_WIRE_BROKEN','EL_WIRING'), ('SL_LOOSE_WIRE','EL_WIRING'),
  ('SL_TRANSFORMER','EL_TRANSFORMER'), ('SL_TRANSFORMER_DAMAGED','EL_TRANSFORMER'), ('SL_TRANSFORMER_FIRE','EL_TRANSFORMER'),
  ('SL_POWER_SUPPLY','EL_POWER_SUPPLY'), ('SL_EB_FAULT','EL_POWER_SUPPLY'), ('SL_HIGH_VOLTAGE','EL_POWER_SUPPLY'),
  ('SL_ELECTRIC_HAZARD','EL_HAZARD'), ('SL_OTHER','EL_OTHER'),
  ('WS_NO_SUPPLY','WS_SUPPLY'), ('WS_LOW_PRESSURE','WS_SUPPLY'), ('WS_CONTAMINATED','WS_QUALITY'),
  ('WL_PIPE_BURST','WL_PIPELINE'), ('WL_TAP_LEAK','WL_PIPELINE'),
  ('DR_BLOCKED','DR_DRAIN'), ('DR_OVERFLOW','DR_DRAIN'),
  ('GB_NOT_COLLECTED','GB_COLLECTION'), ('GB_BURNING','GB_COLLECTION'),
  ('RD_POTHOLE','RD_SURFACE'), ('RD_DAMAGED','RD_SURFACE')
) AS m(issue, sub)
JOIN complaint_subcategories s ON s.code = m.sub
WHERE it.code = m.issue AND it.subcategory_id IS NULL;

ALTER TABLE complaints ADD COLUMN IF NOT EXISTS subcategory_id INTEGER REFERENCES complaint_subcategories(id);
UPDATE complaints c SET subcategory_id = it.subcategory_id
FROM complaint_issue_types it WHERE it.id = c.issue_type_id AND c.subcategory_id IS NULL AND it.subcategory_id IS NOT NULL;

-- Officials asked the citizen for more information (cleared when the citizen replies)
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS info_requested_at TIMESTAMPTZ;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS info_request_note TEXT;

-- Verifier assignments
ALTER TABLE assignments DROP CONSTRAINT IF EXISTS assignments_role_chk;
ALTER TABLE assignments ADD CONSTRAINT assignments_role_chk CHECK (assignee_role IN ('PRIMARY','SUPPORT','SUPERVISOR','VERIFIER'));

-- Citizen feedback on a finished complaint (one per complaint; the citizen may update it)
CREATE TABLE IF NOT EXISTS complaint_feedback (
  id            BIGSERIAL PRIMARY KEY,
  complaint_id  BIGINT NOT NULL UNIQUE REFERENCES complaints(id),
  citizen_id    UUID NOT NULL REFERENCES users(id),
  rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO notification_templates (code, title_en, title_ta, body_en, body_ta, channels) VALUES
  ('INFO_REQUESTED', 'More information needed', 'கூடுதல் தகவல் தேவை',
     'Officials need more information about complaint {code}: {reason}', 'புகார் {code} குறித்து அலுவலர்களுக்குக் கூடுதல் தகவல் தேவை: {reason}', '{IN_APP,SMS}'),
  ('CITIZEN_INFO_ADDED', 'Citizen added information', 'குடிமகன் தகவல் சேர்த்தார்',
     'The citizen added information to complaint {code}.', 'புகார் {code}-க்கு குடிமகன் தகவல் சேர்த்தார்.', '{IN_APP}'),
  ('VERIFIER_ASSIGNED', 'You are the verifier for a complaint', 'புகார் சரிபார்ப்பாளராக நியமிக்கப்பட்டீர்கள்',
     'Please verify the work on complaint {code} ({category}) once it is completed.', 'புகார் {code} ({category}) பணி முடிந்ததும் சரிபார்க்கவும்.', '{IN_APP,PUSH}'),
  ('DUE_DATE_CHANGED', 'Due date changed', 'காலக்கெடு மாற்றப்பட்டது',
     'The due date of complaint {code} is now {due}: {reason}', 'புகார் {code}-இன் காலக்கெடு இப்போது {due}: {reason}', '{IN_APP}'),
  ('FEEDBACK_RECEIVED', 'Citizen feedback received', 'குடிமகன் கருத்து பெறப்பட்டது',
     'The citizen rated the handling of complaint {code}: {rating}/5.', 'புகார் {code}-க்கு குடிமகன் மதிப்பீடு: {rating}/5.', '{IN_APP}')
ON CONFLICT (code) DO NOTHING;

-- Report export (CSV / PDF), scoped by the exporter's jurisdiction
INSERT INTO permissions (code, description, is_security, label, perm_group)
VALUES ('report.export', 'Export complaint reports (CSV / PDF) within jurisdiction', false, 'EXPORT_REPORTS', 'Reports')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'report.export'
WHERE r.code IN ('SUPER_ADMIN', 'SYSTEM_ADMIN', 'EO', 'SUPERVISOR', 'DEPT_OFFICER')
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  ALTER TABLE public.complaint_subcategories ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.complaint_feedback ENABLE ROW LEVEL SECURITY;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nambaooru_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON complaint_subcategories, complaint_feedback TO nambaooru_app';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE complaint_subcategories_id_seq, complaint_feedback_id_seq TO nambaooru_app';
  END IF;
END $$;
