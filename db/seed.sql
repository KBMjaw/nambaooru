-- ============================================================================
-- Namma Ooru — reference / master data seed. Idempotent (ON CONFLICT DO ...).
-- User accounts are NOT seeded here (see scripts/db.ts bootstrap-admin).
-- ============================================================================

-- Languages (add more Indian languages later by inserting rows + a message file)
INSERT INTO languages (code, name_en, native_name, short_label, speech_locale, enabled, sort_order) VALUES
  ('ta', 'Tamil',   'தமிழ்',   'த', 'ta-IN', true, 1),
  ('en', 'English', 'English', 'E', 'en-IN', true, 2)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Roles & permissions
-- ---------------------------------------------------------------------------
INSERT INTO roles (code, name_en, name_ta, portal, rank) VALUES
  ('SUPER_ADMIN',  'Super Admin',                'முதன்மை நிர்வாகி',          'ADMIN',  100),
  ('SYSTEM_ADMIN', 'System / Technology Admin',  'தொழில்நுட்ப நிர்வாகி',       'ADMIN',   90),
  ('EO',           'Executive Officer',          'செயல் அலுவலர்',             'OFFICE',  80),
  ('SUPERVISOR',   'Supervisor',                 'மேற்பார்வையாளர்',           'OFFICE',  60),
  ('DEPT_OFFICER', 'Department Officer',         'துறை அலுவலர்',              'OFFICE',  60),
  ('FIELD_STAFF',  'Field Staff / Worker',       'களப் பணியாளர்',             'OFFICE',  30),
  ('WARD_MEMBER',  'Ward Member / Representative','வார்டு உறுப்பினர்',         'OFFICE',  40),
  ('CITIZEN',      'Citizen',                    'குடிமகன்',                  'PUBLIC',  10)
ON CONFLICT (code) DO NOTHING;

INSERT INTO permissions (code, description, is_security) VALUES
  ('complaint.create',              'Create complaints (citizen)', false),
  ('complaint.view.own',            'View own complaints', false),
  ('appeal.create',                 'Request reconsideration of own complaint', false),
  ('complaint.view.all',            'View complaints across all local bodies (read-only oversight)', false),
  ('complaint.view.localbody',      'View all complaints in own local body', false),
  ('complaint.view.department',     'View complaints of own department within own local body', false),
  ('complaint.view.ward',           'View complaints of own ward', false),
  ('complaint.view.assigned',       'View complaints assigned to self', false),
  ('complaint.review',              'Start initial review', false),
  ('complaint.schedule_inspection', 'Send complaint for site inspection', false),
  ('complaint.inspect',             'Record site inspection', false),
  ('complaint.assign',              'Assign complaint work to staff', false),
  ('complaint.reassign',            'Reassign complaint work', false),
  ('complaint.escalate',            'Escalate complaint to higher authority', false),
  ('complaint.reject',              'Reject / mark duplicate with reason', false),
  ('complaint.work',                'Accept, start, update and complete assigned work', false),
  ('complaint.verify',              'Verify completed work', false),
  ('complaint.close',               'Close complaint', false),
  ('complaint.remark',              'Add remarks to complaints in jurisdiction', false),
  ('appeal.review',                 'Review reconsideration requests', false),
  ('citizen.pii.view',              'View citizen contact details where operationally necessary', false),
  ('map.view',                      'View complaint map', false),
  ('analytics.view',                'View analytics dashboards', false),
  ('audit.view',                    'View audit logs', false),
  ('user.view',                     'View operational users in jurisdiction', false),
  ('user.manage',                   'Create / edit / deactivate operational users in jurisdiction', false),
  ('user.manage.all',               'Manage users of every role incl. EO and admins', true),
  ('role.manage',                   'Configure role permissions', true),
  ('location.manage',               'Manage location master data & imports', false),
  ('masterdata.manage',             'Manage departments, categories, SLA, routing, templates', false),
  ('settings.manage',               'Manage system & security settings', true),
  ('ai.configure',                  'Configure AI / NLP settings', true),
  ('language.manage',               'Manage languages', false)
ON CONFLICT (code) DO NOTHING;

WITH m(role_code, perm_code) AS (VALUES
  ('CITIZEN','complaint.create'),('CITIZEN','complaint.view.own'),('CITIZEN','appeal.create'),

  ('FIELD_STAFF','complaint.view.assigned'),('FIELD_STAFF','complaint.work'),('FIELD_STAFF','complaint.inspect'),

  ('WARD_MEMBER','complaint.view.ward'),('WARD_MEMBER','complaint.remark'),('WARD_MEMBER','complaint.escalate'),
  ('WARD_MEMBER','map.view'),

  ('SUPERVISOR','complaint.view.department'),('SUPERVISOR','complaint.review'),('SUPERVISOR','complaint.schedule_inspection'),
  ('SUPERVISOR','complaint.inspect'),('SUPERVISOR','complaint.assign'),('SUPERVISOR','complaint.reassign'),
  ('SUPERVISOR','complaint.escalate'),('SUPERVISOR','complaint.reject'),('SUPERVISOR','complaint.verify'),
  ('SUPERVISOR','complaint.close'),('SUPERVISOR','complaint.remark'),('SUPERVISOR','map.view'),('SUPERVISOR','analytics.view'),
  ('SUPERVISOR','user.view'),

  ('DEPT_OFFICER','complaint.view.department'),('DEPT_OFFICER','complaint.review'),('DEPT_OFFICER','complaint.schedule_inspection'),
  ('DEPT_OFFICER','complaint.inspect'),('DEPT_OFFICER','complaint.assign'),('DEPT_OFFICER','complaint.reassign'),
  ('DEPT_OFFICER','complaint.escalate'),('DEPT_OFFICER','complaint.reject'),('DEPT_OFFICER','complaint.verify'),
  ('DEPT_OFFICER','complaint.close'),('DEPT_OFFICER','complaint.remark'),('DEPT_OFFICER','map.view'),('DEPT_OFFICER','analytics.view'),
  ('DEPT_OFFICER','user.view'),

  ('EO','complaint.view.localbody'),('EO','complaint.review'),('EO','complaint.schedule_inspection'),('EO','complaint.inspect'),
  ('EO','complaint.assign'),('EO','complaint.reassign'),('EO','complaint.escalate'),('EO','complaint.reject'),
  ('EO','complaint.verify'),('EO','complaint.close'),('EO','complaint.remark'),('EO','appeal.review'),('EO','citizen.pii.view'),
  ('EO','map.view'),('EO','analytics.view'),('EO','audit.view'),('EO','user.view'),('EO','user.manage'),

  ('SYSTEM_ADMIN','complaint.view.all'),('SYSTEM_ADMIN','analytics.view'),('SYSTEM_ADMIN','audit.view'),('SYSTEM_ADMIN','map.view'),
  ('SYSTEM_ADMIN','location.manage'),('SYSTEM_ADMIN','masterdata.manage'),('SYSTEM_ADMIN','language.manage'),('SYSTEM_ADMIN','user.view')
)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM m JOIN roles r ON r.code = m.role_code JOIN permissions p ON p.code = m.perm_code
ON CONFLICT DO NOTHING;

-- Super Admin gets every permission EXCEPT complaint mutations (cannot casually modify official records).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'SUPER_ADMIN'
  AND p.code NOT IN ('complaint.create','complaint.view.own','appeal.create','complaint.review','complaint.schedule_inspection',
                     'complaint.inspect','complaint.assign','complaint.reassign','complaint.reject','complaint.work',
                     'complaint.verify','complaint.close','complaint.remark','complaint.escalate','appeal.review',
                     'complaint.view.localbody','complaint.view.department','complaint.view.ward','complaint.view.assigned')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Location hierarchy
-- ---------------------------------------------------------------------------
INSERT INTO states (code, name_en, name_ta) VALUES ('TN', 'Tamil Nadu', 'தமிழ்நாடு') ON CONFLICT (code) DO NOTHING;

INSERT INTO local_body_types (code, category, name_en, name_ta) VALUES
  ('CORPORATION',       'URBAN', 'Municipal Corporation',            'மாநகராட்சி'),
  ('MUNICIPALITY',      'URBAN', 'Municipality / Municipal Council', 'நகராட்சி'),
  ('TOWN_PANCHAYAT',    'URBAN', 'Town Panchayat',                   'பேரூராட்சி'),
  ('VILLAGE_PANCHAYAT', 'RURAL', 'Village Panchayat',                'கிராம ஊராட்சி')
ON CONFLICT (code) DO NOTHING;

INSERT INTO districts (state_id, code, name_en, name_ta, aliases)
SELECT s.id, d.code, d.name_en, d.name_ta, d.aliases::text[] FROM states s, (VALUES
  ('ARY','Ariyalur','அரியலூர்','{}'),
  ('CGL','Chengalpattu','செங்கல்பட்டு','{Chengalpet}'),
  ('CHN','Chennai','சென்னை','{Madras}'),
  ('CBE','Coimbatore','கோயம்புத்தூர்','{Kovai}'),
  ('CDL','Cuddalore','கடலூர்','{}'),
  ('DPI','Dharmapuri','தருமபுரி','{}'),
  ('DGL','Dindigul','திண்டுக்கல்','{}'),
  ('ERD','Erode','ஈரோடு','{}'),
  ('KLK','Kallakurichi','கள்ளக்குறிச்சி','{Kallakkurichi}'),
  ('KPM','Kanchipuram','காஞ்சிபுரம்','{Kancheepuram}'),
  ('KKM','Kanniyakumari','கன்னியாகுமரி','{Kanyakumari}'),
  ('KRR','Karur','கரூர்','{}'),
  ('KGI','Krishnagiri','கிருஷ்ணகிரி','{}'),
  ('MDU','Madurai','மதுரை','{}'),
  ('MYD','Mayiladuthurai','மயிலாடுதுறை','{}'),
  ('NGT','Nagapattinam','நாகப்பட்டினம்','{}'),
  ('NMK','Namakkal','நாமக்கல்','{}'),
  ('NLG','Nilgiris','நீலகிரி','{"The Nilgiris"}'),
  ('PBL','Perambalur','பெரம்பலூர்','{}'),
  ('PDK','Pudukkottai','புதுக்கோட்டை','{}'),
  ('RMD','Ramanathapuram','இராமநாதபுரம்','{}'),
  ('RPT','Ranipet','இராணிப்பேட்டை','{}'),
  ('SLM','Salem','சேலம்','{}'),
  ('SVG','Sivaganga','சிவகங்கை','{Sivagangai}'),
  ('TKS','Tenkasi','தென்காசி','{}'),
  ('TNJ','Thanjavur','தஞ்சாவூர்','{Tanjore}'),
  ('THN','Theni','தேனி','{}'),
  ('TUT','Thoothukudi','தூத்துக்குடி','{Tuticorin,"Tuticorin Thoothukudi"}'),
  ('TRY','Tiruchirappalli','திருச்சிராப்பள்ளி','{Trichy,Tiruchi}'),
  ('TNV','Tirunelveli','திருநெல்வேலி','{}'),
  ('TPT','Tirupathur','திருப்பத்தூர்','{Tirupattur}'),
  ('TPR','Tiruppur','திருப்பூர்','{Tirupur}'),
  ('TVL','Tiruvallur','திருவள்ளூர்','{Thiruvallur}'),
  ('TVM','Tiruvannamalai','திருவண்ணாமலை','{}'),
  ('TVR','Tiruvarur','திருவாரூர்','{Thiruvarur}'),
  ('VLR','Vellore','வேலூர்','{}'),
  ('VPM','Viluppuram','விழுப்புரம்','{Villupuram}'),
  ('VNR','Virudhunagar','விருதுநகர்','{}')
) AS d(code, name_en, name_ta, aliases)
WHERE s.code = 'TN'
ON CONFLICT (code) DO NOTHING;

-- Erode district taluks (pilot district)
INSERT INTO taluks (district_id, name_en, name_ta)
SELECT d.id, t.en, t.ta FROM districts d, (VALUES
  ('Erode','ஈரோடு'),('Perundurai','பெருந்துறை'),('Gobichettipalayam','கோபிசெட்டிபாளையம்'),
  ('Bhavani','பவானி'),('Sathyamangalam','சத்தியமங்கலம்'),('Anthiyur','அந்தியூர்'),
  ('Kodumudi','கொடுமுடி'),('Modakkurichi','மொடக்குறிச்சி'),('Thalavadi','தாளவாடி'),('Nambiyur','நம்பியூர்')
) AS t(en, ta) WHERE d.code = 'ERD'
ON CONFLICT (district_id, name_en) DO NOTHING;

INSERT INTO blocks (district_id, name_en, name_ta)
SELECT d.id, 'Chennimalai', 'சென்னிமலை' FROM districts d WHERE d.code = 'ERD'
ON CONFLICT (district_id, name_en) DO NOTHING;

-- Pilot local body + a second local body to demonstrate jurisdiction isolation
INSERT INTO local_bodies (code, type_id, district_id, taluk_id, block_id, name_en, name_ta, center_lat, center_lng)
SELECT 'TP-ERD-CHENNIMALAI', t.id, d.id, tk.id, b.id, 'Chennimalai', 'சென்னிமலை', 11.1646, 77.6035
FROM local_body_types t, districts d
JOIN taluks tk ON tk.district_id = d.id AND tk.name_en = 'Perundurai'
JOIN blocks b ON b.district_id = d.id AND b.name_en = 'Chennimalai'
WHERE t.code = 'TOWN_PANCHAYAT' AND d.code = 'ERD'
ON CONFLICT (code) DO NOTHING;

INSERT INTO local_bodies (code, type_id, district_id, taluk_id, name_en, name_ta, center_lat, center_lng)
SELECT 'MUN-ERD-PERUNDURAI', t.id, d.id, tk.id, 'Perundurai', 'பெருந்துறை', 11.2757, 77.5838
FROM local_body_types t, districts d
JOIN taluks tk ON tk.district_id = d.id AND tk.name_en = 'Perundurai'
WHERE t.code = 'MUNICIPALITY' AND d.code = 'ERD'
ON CONFLICT (code) DO NOTHING;

-- Chennimalai wards 1–15 (pilot). Approximate ward centroids around the town centre.
INSERT INTO wards (local_body_id, ward_number, name_en, name_ta, center_lat, center_lng)
SELECT lb.id, w.n, 'Ward ' || w.n, 'வார்டு ' || w.n,
       11.1646 + 0.0055 * sin(w.n * 0.9), 77.6035 + 0.0060 * cos(w.n * 0.9)
FROM local_bodies lb, generate_series(1, 15) AS w(n)
WHERE lb.code = 'TP-ERD-CHENNIMALAI'
ON CONFLICT (local_body_id, ward_number) DO NOTHING;

INSERT INTO wards (local_body_id, ward_number, name_en, name_ta, center_lat, center_lng)
SELECT lb.id, w.n, 'Ward ' || w.n, 'வார்டு ' || w.n,
       11.2757 + 0.006 * sin(w.n), 77.5838 + 0.006 * cos(w.n)
FROM local_bodies lb, generate_series(1, 6) AS w(n)
WHERE lb.code = 'MUN-ERD-PERUNDURAI'
ON CONFLICT (local_body_id, ward_number) DO NOTHING;

INSERT INTO streets (ward_id, name_en, name_ta)
SELECT w.id, s.en, s.ta FROM wards w JOIN local_bodies lb ON lb.id = w.local_body_id, (VALUES
  (1,'Main Bazaar Street','மெயின் பஜார் தெரு'),
  (1,'Sannathi Street','சன்னதி தெரு'),
  (2,'Car Street','தேர் வீதி'),
  (2,'Temple Hill Road','கோவில் மலை சாலை'),
  (3,'Bus Stand Road','பேருந்து நிலைய சாலை'),
  (3,'Market Street','சந்தை தெரு'),
  (4,'Perundurai Road','பெருந்துறை சாலை'),
  (5,'Erode Road','ஈரோடு சாலை'),
  (6,'Kangayam Road','காங்கேயம் சாலை'),
  (7,'Weavers Colony','நெசவாளர் காலனி'),
  (8,'Murugan Nagar','முருகன் நகர்'),
  (9,'Gandhi Nagar','காந்தி நகர்'),
  (10,'Kothangadu 1st Street','கொத்தங்காடு 1வது தெரு'),
  (10,'Kothangadu 2nd Street','கொத்தங்காடு 2வது தெரு'),
  (10,'Kothangadu Main Road','கொத்தங்காடு மெயின் ரோடு'),
  (11,'Kamarajar Street','காமராஜர் தெரு'),
  (12,'Anna Nagar','அண்ணா நகர்'),
  (13,'MGR Nagar','எம்.ஜி.ஆர் நகர்'),
  (14,'Periyar Street','பெரியார் தெரு'),
  (15,'Bharathiyar Street','பாரதியார் தெரு')
) AS s(ward_no, en, ta)
WHERE lb.code = 'TP-ERD-CHENNIMALAI' AND w.ward_number = s.ward_no
ON CONFLICT (ward_id, name_en) DO NOTHING;

INSERT INTO streets (ward_id, name_en, name_ta)
SELECT w.id, 'Ward ' || w.ward_number || ' Main Street', 'வார்டு ' || w.ward_number || ' மெயின் தெரு'
FROM wards w JOIN local_bodies lb ON lb.id = w.local_body_id WHERE lb.code = 'MUN-ERD-PERUNDURAI'
ON CONFLICT (ward_id, name_en) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Departments (per local body)
-- ---------------------------------------------------------------------------
INSERT INTO departments (code, local_body_id, name_en, name_ta)
SELECT d.code, lb.id, d.en, d.ta FROM local_bodies lb, (VALUES
  ('ELECTRICAL',    'Street Lighting / Electrical', 'தெருவிளக்கு / மின் பிரிவு'),
  ('WATER',         'Water Supply',                 'குடிநீர் விநியோகப் பிரிவு'),
  ('ENGINEERING',   'Engineering & Roads',          'பொறியியல் மற்றும் சாலைப் பிரிவு'),
  ('SANITATION',    'Sanitation & Solid Waste',     'துப்புரவு மற்றும் திடக்கழிவு மேலாண்மை'),
  ('HEALTH',        'Public Health',                'பொது சுகாதாரப் பிரிவு'),
  ('TOWN_PLANNING', 'Town Planning',                'நகரமைப்புப் பிரிவு'),
  ('GENERAL_ADMIN', 'General Administration',       'பொது நிர்வாகம்')
) AS d(code, en, ta)
ON CONFLICT (code, local_body_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Complaint categories
-- ---------------------------------------------------------------------------
INSERT INTO complaint_categories (code, name_en, name_ta, icon, default_department, evidence_required, evidence_types, inspection_required, default_priority, sort_order) VALUES
  ('STREET_LIGHT',  'Street Light',               'தெரு விளக்கு',               '💡', 'ELECTRICAL',    true,  '{photo}',       true,  'MEDIUM', 1),
  ('WATER_SUPPLY',  'Drinking Water Supply',      'குடிநீர் விநியோகம்',          '🚰', 'WATER',         false, '{photo,video}', true,  'HIGH',   2),
  ('WATER_LEAK',    'Water Pipeline Leak',        'குடிநீர் குழாய் உடைப்பு',      '💧', 'WATER',         true,  '{photo,video}', true,  'HIGH',   3),
  ('DRAINAGE',      'Drainage / Sewage',          'கழிவுநீர் / வடிகால்',          '🌊', 'SANITATION',    true,  '{photo,video}', true,  'HIGH',   4),
  ('ROAD_DAMAGE',   'Road Damage / Potholes',     'சாலை சேதம் / குழிகள்',         '🛣️', 'ENGINEERING',   true,  '{photo}',       true,  'MEDIUM', 5),
  ('GARBAGE',       'Garbage / Solid Waste',      'குப்பை / திடக்கழிவு',          '🗑️', 'SANITATION',    true,  '{photo}',       true,  'MEDIUM', 6),
  ('MOSQUITO',      'Mosquito / Public Health',   'கொசு / பொது சுகாதாரம்',        '🦟', 'HEALTH',        false, '{photo}',       true,  'MEDIUM', 7),
  ('STRAY_ANIMALS', 'Stray Dogs / Animals',       'தெருநாய் / கால்நடைகள்',        '🐕', 'HEALTH',        false, '{photo,video}', true,  'MEDIUM', 8),
  ('TREE_FALL',     'Fallen Tree / Branches',     'மரம் / கிளை விழுந்தது',        '🌳', 'ENGINEERING',   true,  '{photo}',       true,  'HIGH',   9),
  ('PUBLIC_TOILET', 'Public Toilet',              'பொதுக் கழிப்பறை',             '🚻', 'SANITATION',    true,  '{photo}',       true,  'MEDIUM', 10),
  ('ENCROACHMENT',  'Encroachment',               'ஆக்கிரமிப்பு',                '🚧', 'TOWN_PLANNING', true,  '{photo}',       true,  'LOW',    11),
  ('OTHER',         'Other Civic Issue',          'பிற குடிமைப் பிரச்சினை',       '📌', 'GENERAL_ADMIN', false, '{photo,video}', true,  'MEDIUM', 99)
ON CONFLICT (code) DO NOTHING;

-- SLA rules: defaults by priority + category overrides
INSERT INTO sla_rules (category_id, priority, inspection_hours, resolution_hours, warn_before_hours) VALUES
  (NULL, 'CRITICAL', 6,  24,  6),
  (NULL, 'HIGH',     24, 72,  12),
  (NULL, 'MEDIUM',   48, 168, 24),
  (NULL, 'LOW',      72, 336, 48)
ON CONFLICT DO NOTHING;
INSERT INTO sla_rules (category_id, priority, inspection_hours, resolution_hours, warn_before_hours)
SELECT c.id, 'MEDIUM', 24, 72, 12 FROM complaint_categories c WHERE c.code = 'STREET_LIGHT'
ON CONFLICT DO NOTHING;
INSERT INTO sla_rules (category_id, priority, inspection_hours, resolution_hours, warn_before_hours)
SELECT c.id, 'HIGH', 12, 48, 12 FROM complaint_categories c WHERE c.code = 'STREET_LIGHT'
ON CONFLICT DO NOTHING;

-- Routing rules: every category → matching department in each local body
INSERT INTO routing_rules (local_body_id, category_id, department_id)
SELECT lb.id, c.id, d.id FROM local_bodies lb
JOIN complaint_categories c ON true
JOIN departments d ON d.local_body_id = lb.id AND d.code = c.default_department
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Notification templates ({code} {category} {status} {reason} placeholders)
-- ---------------------------------------------------------------------------
INSERT INTO notification_templates (code, title_en, title_ta, body_en, body_ta, channels) VALUES
  ('SUBMITTED',  'Complaint registered', 'புகார் பதிவு செய்யப்பட்டது',
     'Your complaint {code} ({category}) has been registered. We will keep you updated.',
     'உங்கள் புகார் {code} ({category}) பதிவு செய்யப்பட்டது. நிலை மாற்றங்களை உங்களுக்குத் தெரிவிப்போம்.', '{IN_APP,SMS}'),
  ('ACCEPTED',   'Complaint under review', 'புகார் பரிசீலனையில் உள்ளது',
     'Complaint {code} is now being reviewed by officials.', 'புகார் {code} அலுவலர்களால் பரிசீலிக்கப்படுகிறது.', '{IN_APP}'),
  ('INSPECTION_SCHEDULED', 'Site inspection scheduled', 'கள ஆய்வு திட்டமிடப்பட்டது',
     'A site inspection has been scheduled for complaint {code}.', 'புகார் {code}-க்கு கள ஆய்வு திட்டமிடப்பட்டுள்ளது.', '{IN_APP}'),
  ('VERIFIED',   'Issue verified', 'பிரச்சினை உறுதி செய்யப்பட்டது',
     'Officials verified the issue in complaint {code} at the site.', 'புகார் {code}-இல் உள்ள பிரச்சினை களத்தில் உறுதி செய்யப்பட்டது.', '{IN_APP}'),
  ('ASSIGNED',   'Work assigned', 'பணி ஒதுக்கப்பட்டது',
     'Work for complaint {code} has been assigned to field staff.', 'புகார் {code}-க்கான பணி களப் பணியாளருக்கு ஒதுக்கப்பட்டது.', '{IN_APP,SMS}'),
  ('STAFF_ASSIGNED', 'New work assigned', 'புதிய பணி ஒதுக்கப்பட்டது',
     'New work assigned: {code} ({category}).', 'புதிய பணி: {code} ({category}).', '{IN_APP,PUSH}'),
  ('WORK_STARTED', 'Work started', 'பணி தொடங்கியது',
     'Work has started on complaint {code}.', 'புகார் {code}-இல் பணி தொடங்கியது.', '{IN_APP}'),
  ('PROGRESS',   'Progress updated', 'முன்னேற்றம் புதுப்பிக்கப்பட்டது',
     'Progress was updated on complaint {code}.', 'புகார் {code}-இன் பணி முன்னேற்றம் புதுப்பிக்கப்பட்டது.', '{IN_APP}'),
  ('WORK_COMPLETED', 'Work completed', 'பணி முடிந்தது',
     'Field staff reported work completed for {code}. Awaiting officer verification.', '{code} பணி முடிந்ததாகத் தெரிவிக்கப்பட்டது. அலுவலர் சரிபார்ப்புக்காகக் காத்திருக்கிறது.', '{IN_APP}'),
  ('COMPLETION_VERIFIED', 'Resolution verified', 'தீர்வு சரிபார்க்கப்பட்டது',
     'An officer verified the resolution of complaint {code}.', 'புகார் {code}-இன் தீர்வை அலுவலர் சரிபார்த்தார்.', '{IN_APP}'),
  ('REJECTED',   'Complaint not accepted', 'புகார் ஏற்கப்படவில்லை',
     'Complaint {code} was not accepted. Reason: {reason}. You may request reconsideration.', 'புகார் {code} ஏற்கப்படவில்லை. காரணம்: {reason}. மறுபரிசீலனை கோரலாம்.', '{IN_APP,SMS}'),
  ('DUPLICATE',  'Marked as duplicate', 'இரட்டைப் புகாராகக் குறிக்கப்பட்டது',
     'Complaint {code} is the same as an existing complaint. You can track the original complaint.', 'புகார் {code} ஏற்கனவே உள்ள புகாருடன் ஒன்றாக உள்ளது. அசல் புகாரைக் கண்காணிக்கலாம்.', '{IN_APP}'),
  ('CLOSED',     'Complaint closed', 'புகார் முடிக்கப்பட்டது',
     'Complaint {code} has been resolved and closed. Thank you!', 'புகார் {code} தீர்க்கப்பட்டு முடிக்கப்பட்டது. நன்றி!', '{IN_APP,SMS}'),
  ('REOPENED',   'Complaint reopened', 'புகார் மீண்டும் திறக்கப்பட்டது',
     'Your reconsideration request for {code} was accepted and the complaint is reopened.', '{code}-க்கான மறுபரிசீலனை ஏற்கப்பட்டு புகார் மீண்டும் திறக்கப்பட்டது.', '{IN_APP}'),
  ('APPEAL_REJECTED', 'Reconsideration decided', 'மறுபரிசீலனை முடிவு',
     'Your reconsideration request for {code} was reviewed and not accepted: {reason}', '{code}-க்கான உங்கள் மறுபரிசீலனை கோரிக்கை ஏற்கப்படவில்லை: {reason}', '{IN_APP}'),
  ('SLA_APPROACHING', 'SLA deadline approaching', 'காலக்கெடு நெருங்குகிறது',
     'Complaint {code} is approaching its resolution deadline.', 'புகார் {code} தீர்வுக் காலக்கெடுவை நெருங்குகிறது.', '{IN_APP}'),
  ('SLA_BREACHED', 'SLA deadline breached', 'காலக்கெடு மீறப்பட்டது',
     'Complaint {code} has crossed its resolution deadline.', 'புகார் {code} தீர்வுக் காலக்கெடுவைக் கடந்துவிட்டது.', '{IN_APP}'),
  ('NEW_COMPLAINT', 'New complaint received', 'புதிய புகார் வந்துள்ளது',
     'New complaint {code} ({category}) in your jurisdiction needs review.', 'உங்கள் அதிகார வரம்பில் புதிய புகார் {code} ({category}) பரிசீலனைக்கு வந்துள்ளது.', '{IN_APP}'),
  ('APPEAL_SUBMITTED', 'Reconsideration requested', 'மறுபரிசீலனை கோரப்பட்டது',
     'The citizen requested reconsideration of complaint {code}.', 'புகார் {code}-க்கு குடிமகன் மறுபரிசீலனை கோரியுள்ளார்.', '{IN_APP}'),
  ('INSPECTION_ASSIGNED', 'Site inspection assigned', 'கள ஆய்வு ஒதுக்கப்பட்டது',
     'Please inspect the site for complaint {code} ({category}).', 'புகார் {code} ({category})-க்கு கள ஆய்வு செய்யவும்.', '{IN_APP,PUSH}'),
  ('WORK_REVIEW', 'Work completed — verify', 'பணி முடிந்தது — சரிபார்க்கவும்',
     'Field staff completed work on {code}. Please verify the completion evidence.', '{code} பணி முடிந்தது. நிறைவு ஆதாரத்தைச் சரிபார்க்கவும்.', '{IN_APP}'),
  ('ESCALATED',  'Complaint escalated', 'புகார் உயர் அதிகாரிக்கு அனுப்பப்பட்டது',
     'Complaint {code} has been escalated to a higher authority.', 'புகார் {code} உயர் அதிகாரிக்கு அனுப்பப்பட்டது.', '{IN_APP}')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- System settings
-- ---------------------------------------------------------------------------
INSERT INTO system_settings (key, value, is_security) VALUES
  ('ai.engine',            '"auto"', true),        -- auto | rules | llm
  ('ai.llm_model',         '"claude-opus-5"', true),
  ('duplicate.radius_m',   '150', false),
  ('duplicate.window_days','45', false),
  ('gps.conflict_km',      '3', false),
  ('upload.max_photo_mb',  '3', false),
  ('upload.max_video_mb',  '4', false),
  ('auth.max_failed_logins','5', true),
  ('auth.lockout_minutes', '15', true),
  ('auth.session_hours',   '12', true),
  ('pilot.local_body_code','"TP-ERD-CHENNIMALAI"', false)
ON CONFLICT (key) DO NOTHING;
