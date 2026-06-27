-- 010: admin-managed invites.
--
-- Extends the invite allowlist (migration 009) so invites can be managed from the
-- in-app Settings page instead of hand-written SQL. Adds an `is_admin` flag: only
-- admins may invite or revoke teammates. Enforced server-side in
-- src/app/api/team/route.ts via isEmailAdmin() in src/lib/auth/allowlist.ts.
-- Idempotent, additive.

ALTER TABLE allowed_users
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

-- Seed the founding admin so the Settings page is usable.
INSERT INTO allowed_users (email, invited_by, is_admin)
  VALUES ('stuart@grantsea.com.au', 'Stuart Grant', true)
  ON CONFLICT (email) DO UPDATE SET is_admin = true;
