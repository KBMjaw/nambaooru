-- Namma Ooru: action notes and completion evidence (migration 007, idempotent)
--   * GPS is optional on a completion report (captured when the phone allows it); the after-work photo stays mandatory
--   * notification for public progress notes written by officials / field staff

ALTER TABLE completion_evidence ALTER COLUMN latitude DROP NOT NULL;
ALTER TABLE completion_evidence ALTER COLUMN longitude DROP NOT NULL;

INSERT INTO notification_templates (code, title_en, title_ta, body_en, body_ta, channels) VALUES
  ('PUBLIC_UPDATE', 'Update on your complaint', 'உங்கள் புகார் குறித்த தகவல்',
     'Update on complaint {code}: {reason}', 'புகார் {code} குறித்த தகவல்: {reason}', '{IN_APP}')
ON CONFLICT (code) DO NOTHING;
