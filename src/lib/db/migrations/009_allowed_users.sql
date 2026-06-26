-- 009: sign-in invite allowlist.
--
-- Access is invite-only. An email may complete sign-in only if it is BOTH on the
-- @grantsea.com.au domain AND present in this table. Enforced server-side in
-- src/app/auth/callback/route.ts via src/lib/auth/allowlist.ts (the magic-link
-- callback signs out and rejects anyone not listed here). Idempotent, additive.
--
-- Manage invites with plain SQL:
--   INSERT INTO allowed_users (email, invited_by) VALUES ('person@grantsea.com.au','Stuart Grant')
--     ON CONFLICT (email) DO NOTHING;        -- invite
--   DELETE FROM allowed_users WHERE email = 'person@grantsea.com.au';  -- revoke
-- Emails are stored lower-cased; the app normalises before comparing.

CREATE TABLE IF NOT EXISTS allowed_users (
  email       text PRIMARY KEY,
  invited_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Seed the founding admin so login keeps working. REPLACE the address below with
-- Stuart's real @grantsea.com.au email before running, or run the INSERT separately.
-- INSERT INTO allowed_users (email, invited_by)
--   VALUES ('stuart@grantsea.com.au', 'Stuart Grant')
--   ON CONFLICT (email) DO NOTHING;
