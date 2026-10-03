-- 009: "Mark as completed" by any officer handling the complaint, with reference photo + GPS;
-- final approval & closure only by the EO or an Admin / Super Admin above the EO;
-- site inspection no longer mandatory for any category. Additive / data-only, idempotent.

INSERT INTO permissions (code, description, is_security, label, perm_group) VALUES
  ('complaint.complete', 'Mark complaint work completed as an officer (reference photo + GPS)', false, 'MARK_COMPLETED', 'Work'),
  ('complaint.final_approve', 'Final approval and closure of completed work', false, 'FINAL_APPROVE', 'Complaints')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'complaint.complete'
WHERE r.code IN ('SUPERVISOR', 'DEPT_OFFICER', 'EO')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'complaint.final_approve'
WHERE r.code IN ('EO', 'SYSTEM_ADMIN', 'SUPER_ADMIN')
ON CONFLICT DO NOTHING;

-- Site inspection is optional for every category (officers may still send a complaint for inspection)
UPDATE complaint_categories SET inspection_required = false WHERE inspection_required;

-- How each completion was captured (shown to the approver)
ALTER TABLE completion_evidence ADD COLUMN IF NOT EXISTS completed_by_rank INTEGER;
ALTER TABLE completion_evidence ADD COLUMN IF NOT EXISTS distance_m DOUBLE PRECISION;
ALTER TABLE completion_evidence ADD COLUMN IF NOT EXISTS capture_device TEXT;
ALTER TABLE completion_evidence ADD COLUMN IF NOT EXISTS live_photo BOOLEAN;
ALTER TABLE completion_evidence DROP CONSTRAINT IF EXISTS completion_evidence_device_chk;
ALTER TABLE completion_evidence ADD CONSTRAINT completion_evidence_device_chk CHECK (capture_device IS NULL OR capture_device IN ('MOBILE','DESKTOP'));
