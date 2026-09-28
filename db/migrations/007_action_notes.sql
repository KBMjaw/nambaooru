-- Namma Ooru: action notes and completion evidence (migration 007, idempotent)
--   * GPS is optional on a completion report (captured when the phone allows it); the after-work photo stays mandatory
--   * notification for public progress notes written by officials / field staff

ALTER TABLE completion_evidence ALTER COLUMN latitude DROP NOT NULL;
ALTER TABLE completion_evidence ALTER COLUMN longitude DROP NOT NULL;

INSERT INTO notification_templates (code, title_en, title_ta, body_en, body_ta, channels) VALUES
  ('PUBLIC_UPDATE', 'Update on your complaint', 'உங்கள் புகார் குறித்த தகவல்',
     'Update on complaint {code}: {reason}', 'புகார் {code} குறித்த தகவல்: {reason}', '{IN_APP}')
  ,('REWORK_CITIZEN', 'Rework required on your complaint', 'உங்கள் புகாரில் மீண்டும் பணி தேவை',
     'Verification of the work on complaint {code} found it incomplete. The work is being redone: {reason}', 'புகார் {code}-இன் பணி சரிபார்ப்பில் முழுமையடையவில்லை. மீண்டும் செய்யப்படுகிறது: {reason}', '{IN_APP}')
ON CONFLICT (code) DO NOTHING;

-- Acknowledgement names the department that has the complaint
UPDATE notification_templates SET
  title_en = 'Complaint received and under review', title_ta = 'புகார் பெறப்பட்டு பரிசீலனையில் உள்ளது',
  body_en = 'Complaint {code} has been received by {department} and is under review.',
  body_ta = 'புகார் {code} {department} துறையால் பெறப்பட்டு பரிசீலிக்கப்படுகிறது.'
WHERE code = 'ACCEPTED' AND body_en = 'Complaint {code} is now being reviewed by officials.';
