-- Namma Ooru: server-side sessions (migration 004, idempotent)
-- Every login creates a row; the session cookie carries its id and is honoured only while the row is
-- active, so logout (and expiry) invalidates the token server-side instead of just clearing the cookie.
-- The token_version check on users stays in place for "log out everywhere" events (password reset,
-- deactivation).

CREATE TABLE IF NOT EXISTS user_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  portal      TEXT NOT NULL CHECK (portal IN ('PUBLIC', 'OFFICE', 'ADMIN')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS user_sessions_user_idx ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS user_sessions_expiry_idx ON user_sessions (expires_at);

DO $$
BEGIN
  ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nambaooru_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON user_sessions TO nambaooru_app';
  END IF;
END $$;
