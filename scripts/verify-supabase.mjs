/**
 * Read-only check of what actually landed in Supabase.
 *
 *   node scripts/verify-supabase.mjs
 *
 * Writes nothing. Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from
 * .env.local and reports row counts, the submitted_at date range, and
 * anything that looks like a failed migration — chiefly rows whose
 * timestamp collapsed to "today", which is what a date-parse fallback
 * produces and what a count alone would never reveal.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let env = {};
try {
  env = Object.fromEntries(
    readFileSync(join(root, '.env.local'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => {
        const eq = l.indexOf('=');
        return [l.slice(0, eq).trim(), l.slice(eq + 1).trim().replace(/^["']|["']$/g, '')];
      })
  );
} catch {
  console.error('\n  .env.local not found\n');
  process.exit(1);
}

const URL_ = env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_ || !KEY) {
  console.error('\n  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local\n');
  process.exit(1);
}

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function count(table) {
  const res = await fetch(`${URL_}/rest/v1/${table}?select=*&limit=1`, {
    headers: { ...headers, Prefer: 'count=exact' }
  });
  if (!res.ok) throw new Error(`${table}: HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`);
  // content-range looks like "0-0/413"
  const range = res.headers.get('content-range') || '';
  return Number(range.split('/')[1] ?? 0);
}

async function rows(table, select, extra = '') {
  const res = await fetch(`${URL_}/rest/v1/${table}?select=${select}&limit=2000${extra}`, { headers });
  if (!res.ok) throw new Error(`${table}: HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const pad = (s, n) => String(s).padEnd(n);

async function run() {
  console.log(`\n  ${URL_}\n  ${'─'.repeat(58)}`);

  const tables = ['applications', 'users', 'settings', 'audit_log', 'interviews', 'assessments'];
  const counts = {};

  for (const t of tables) {
    counts[t] = await count(t);
    console.log(`  ${pad(t, 16)} ${String(counts[t]).padStart(5)} rows`);
  }

  if (!counts.applications) {
    console.log('\n  applications is empty — nothing else to check.\n');
    return;
  }

  const apps = await rows(
    'applications',
    'application_id,submitted_at,last_activity,stage,rating,tags,archived_at'
  );

  const dates = apps.map((a) => a.submitted_at).filter(Boolean).sort();
  const earliest = dates[0];
  const latest = dates[dates.length - 1];

  // A date-parse fallback stamps new Date(), so a pile of rows sharing
  // today's date is the signature of a failed migration.
  const today = new Date().toISOString().slice(0, 10);
  const stampedToday = apps.filter((a) => String(a.submitted_at).slice(0, 10) === today).length;

  const distinctDays = new Set(apps.map((a) => String(a.submitted_at).slice(0, 10))).size;
  const stages = [...new Set(apps.map((a) => a.stage))];
  const dupes = apps.length - new Set(apps.map((a) => a.application_id)).size;

  console.log(`\n  Applications\n  ${'─'.repeat(58)}`);
  console.log(`  earliest submitted_at   ${earliest}`);
  console.log(`  latest submitted_at     ${latest}`);
  console.log(`  distinct calendar days  ${distinctDays}`);
  console.log(`  stamped today (${today})  ${stampedToday}`);
  console.log(`  duplicate ids           ${dupes}`);
  console.log(`  archived                ${apps.filter((a) => a.archived_at).length}`);
  console.log(`  rated                   ${apps.filter((a) => a.rating > 0).length}`);
  console.log(`  tagged                  ${apps.filter((a) => (a.tags || []).length).length}`);
  console.log(`  stages                  ${stages.join(', ')}`);

  const audit = await rows('audit_log', 'application_id');
  const linked = audit.filter((a) => a.application_id).length;
  console.log(`\n  Audit log\n  ${'─'.repeat(58)}`);
  console.log(`  linked to an application   ${linked}`);
  console.log(`  unlinked (orphan nulled)   ${audit.length - linked}`);

  const problems = [];
  if (dupes) problems.push(`${dupes} duplicate application_id`);
  if (stampedToday > 5) {
    problems.push(
      `${stampedToday} rows stamped today — date parsing likely fell back to new Date()`
    );
  }
  if (distinctDays < 2) problems.push('all applications share one calendar day');

  console.log(`\n  ${'─'.repeat(58)}`);
  if (problems.length) {
    problems.forEach((p) => console.log(`  [ FAIL ] ${p}`));
    console.log('\n  NOT CLEAN — truncate and re-run the migration\n');
    process.exitCode = 1;
  } else {
    console.log('  MIGRATION LOOKS CLEAN\n');
  }
}

run().catch((err) => {
  console.error(`\n  Verify failed: ${err.message}\n`);
  process.exitCode = 1;
});
