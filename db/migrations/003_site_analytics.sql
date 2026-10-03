-- Namma Ooru: privacy-friendly public website visitor counts (migration 003, idempotent)
-- Aggregate page views for PUBLIC pages only (/admin/*, /office/* and /api/* are never recorded).
-- No IP address, user agent, user id, query string or complaint code is stored: a visitor is a
-- salted hash of (IP, user agent) whose salt is random per day and deleted after two days, so
-- hashes cannot be linked across days or reversed to an IP.

CREATE TABLE IF NOT EXISTS site_analytics_salts (
  day  DATE PRIMARY KEY,
  salt BYTEA NOT NULL
);

CREATE TABLE IF NOT EXISTS site_page_views (
  day          DATE NOT NULL,              -- Asia/Kolkata calendar day
  path         TEXT NOT NULL,              -- normalised public route, e.g. '/', '/report', '/complaints/[code]'
  visitor_hash TEXT NOT NULL,              -- daily-salted hash, unlinkable across days
  views        INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (day, path, visitor_hash)
);
CREATE INDEX IF NOT EXISTS site_page_views_day_idx ON site_page_views (day);

INSERT INTO permissions (code, description, is_security, label, perm_group) VALUES
  ('site_analytics.view', 'View aggregate public website visitor analytics', false, 'VIEW_WEBSITE_ANALYTICS', 'Maps & analytics')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'site_analytics.view'
WHERE r.code IN ('SUPER_ADMIN', 'SYSTEM_ADMIN')
ON CONFLICT DO NOTHING;

-- RLS without policies: the Supabase REST API gets nothing.
DO $$
BEGIN
  ALTER TABLE public.site_analytics_salts ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.site_page_views ENABLE ROW LEVEL SECURITY;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nambaooru_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON site_analytics_salts, site_page_views TO nambaooru_app';
  END IF;
END $$;
