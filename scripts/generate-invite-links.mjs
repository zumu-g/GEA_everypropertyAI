#!/usr/bin/env node
// Generate per-person set-password links for invited teammates, bypassing
// Supabase's (unreliable) built-in invite email. Run locally with the
// service-role key in the environment — the links it prints are credentials,
// so hand each person theirs directly and don't paste them anywhere shared.
//
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   SITE_URL=https://everypropertyai.com \
//   node scripts/generate-invite-links.mjs a@grantsea.com.au b@grantsea.com.au
//
// ponytail: plain fetch against the GoTrue admin API — supabase-js needs a
// WebSocket global this Node lacks, and we only need one endpoint anyway.

const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const site = process.env.SITE_URL ?? 'https://everypropertyai.com';

if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const emails = process.argv.slice(2).map((a) => a.trim().toLowerCase());
if (emails.length === 0) {
  console.error('Usage: node scripts/generate-invite-links.mjs <email> ...');
  process.exit(1);
}

const redirectTo = `${site}/auth/callback?returnTo=/auth/set-password`;

async function generateLink(type, email) {
  const res = await fetch(`${url}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type, email, redirect_to: redirectTo }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data.msg ?? data.message ?? `HTTP ${res.status}` };
  return { link: data.action_link };
}

for (const email of emails) {
  // 'invite' for a brand-new user; fall back to 'recovery' if they already exist.
  let out = await generateLink('invite', email);
  if (out.error && /already|exist/i.test(out.error)) out = await generateLink('recovery', email);
  console.log(`${email}\t${out.link ?? `ERROR: ${out.error}`}`);
}
