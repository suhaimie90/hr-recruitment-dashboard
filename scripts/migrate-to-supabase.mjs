/**
 * One-time migration: Google Sheet CSV exports -> Supabase Postgres.
 *
 *   node scripts/migrate-to-supabase.mjs            # dry run, writes nothing
 *   node scripts/migrate-to-supabase.mjs --commit   # actually inserts
 *
 * Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local.
 *
 * Deliberately does NOT go through the Apps Script API: the
 * `applications` endpoint returns a trimmed payload (no IC number,
 * address, postcode, cover message or resume filename), so complete
 * records would need ~1200 per-record calls against an endpoint that
 * intermittently returns Google 404 HTML. CSV export is one step and
 * carries everything.
 *
 * Export these six tabs from the Sheet (File -> Download ->
 * Comma-separated values) into migration-data/ :
 *
 *   applications.csv  users.csv  settings.csv
 *   auditlog.csv      interviews.csv  assessments.csv
 *
 * Anything missing is skipped with a warning, so a partial export
 * still runs. migration-data/ is covered by .gitignore's *.csv rule —
 * these files carry IC numbers and phone numbers, never commit them.
 *
 * Dates: format the Sheet's date columns as yyyy-mm-dd hh:mm:ss before
 * exporting (Format -> Number -> Custom date and time). Otherwise the
 * export uses locale formatting and d/m/yyyy vs m/d/yyyy is genuinely
 * ambiguous — the parser below assumes day-first for Malaysia and
 * reports every value it had to guess on.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'migration-data');
const COMMIT = process.argv.includes('--commit');
const DUMP = process.argv.includes('--dump');

// Malaysia is UTC+8. A bare sheet timestamp has no offset, so it is
// anchored here rather than being silently read as UTC.
const TZ_OFFSET = '+08:00';

const warnings = [];
const warn = (msg) => warnings.push(msg);

// ── env ─────────────────────────────────────────────────
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
  fail('.env.local not found in hr-recruitment-dashboard/');
}

const SUPABASE_URL = env.SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

function fail(msg) {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

/**
 * RFC-4180 parser. Written out rather than pulled from npm because
 * cover messages contain commas AND newlines AND quotes — a naive
 * split(',') silently shreds them into misaligned rows.
 */
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }

    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }

    field += c;
    i++;
  }

  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Same normalisation the Apps Script uses (normKey_), so "Full Name",
// "full name" and "FullName" all resolve to one key.
const normKey = (h) => String(h).toLowerCase().replace(/[^a-z0-9]/g, '');

function readTable(file) {
  const path = join(dataDir, file);
  if (!existsSync(path)) {
    // Silently treating a missing file as empty hid a misspelled
    // "assesments.csv" once — say so loudly instead.
    warn(`${file} not found in migration-data/ — that table will be empty`);
    return null;
  }

  const rows = parseCsv(readFileSync(path, 'utf8')).filter((r) =>
    r.some((c) => String(c).trim() !== '')
  );
  if (!rows.length) return [];

  const headers = rows[0].map(normKey);
  return rows.slice(1).map((cells) => {
    const o = {};
    headers.forEach((h, idx) => {
      if (h) o[h] = (cells[idx] ?? '').trim();
    });
    return o;
  });
}

// First key that holds a value — mirrors pick_() in DashboardApi.gs,
// which is what lets one codebase read "Resume Link" or "Resume URL".
const pick = (row, keys) => {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== '') return row[k];
  }
  return '';
};

// The sheet stores IC and phone with a leading apostrophe to stop
// Sheets mangling them into numbers.
const stripQuote = (v) => String(v ?? '').replace(/^'/, '').trim();

const nullIfBlank = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

function toBool(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === 'y' || s === '1' || s === 'active';
}

function toInt(v, fallback = 0) {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/**
 * Sheet timestamp -> ISO string, or null.
 *
 * Handles ISO, "yyyy-mm-dd hh:mm:ss", and slash formats. Slash dates
 * are ambiguous (03/04 = 3 April or March 4), so day-first is assumed
 * for Malaysia and every such value is reported.
 */
function toTimestamp(v, label) {
  const s = String(v ?? '').trim();
  if (!s) return null;

  // Already carries a timezone.
  if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s);
    return isNaN(d) ? (warn(`${label}: unparseable "${s}"`), null) : d.toISOString();
  }

  // yyyy-mm-dd [hh:mm[:ss]]
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ]?(\d{2})?:?(\d{2})?:?(\d{2})?$/);
  if (m) {
    const [, y, mo, d, h = '00', mi = '00', se = '00'] = m;
    return new Date(`${y}-${mo}-${d}T${h}:${mi}:${se}${TZ_OFFSET}`).toISOString();
  }

  // yyyymmdd [hh:mm[:ss]] — no separators. This is what the Sheet's
  // date format actually produces ("20260716 13:19:33"), and it is
  // unambiguous, unlike the slash formats below.
  m = s.match(/^(\d{4})(\d{2})(\d{2})[T ]?(?:(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const [, y, mo, d, h = '00', mi = '00', se = '00'] = m;
    const iso = `${y}-${mo}-${d}T${String(h).padStart(2, '0')}:${mi}:${se}${TZ_OFFSET}`;
    const dt = new Date(iso);
    return isNaN(dt) ? (warn(`${label}: unparseable "${s}"`), null) : dt.toISOString();
  }

  // d/m/yyyy or m/d/yyyy — assume day-first.
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[, ]*(\d{1,2})?:?(\d{2})?:?(\d{2})?\s*(AM|PM)?$/i);
  if (m) {
    let [, a, b, y, h = '0', mi = '00', se = '00', ampm] = m;
    let hour = Number(h);
    if (ampm) {
      if (/pm/i.test(ampm) && hour !== 12) hour += 12;
      if (/am/i.test(ampm) && hour === 12) hour = 0;
    }
    const day = a.padStart(2, '0');
    const mon = b.padStart(2, '0');

    if (Number(a) <= 12 && Number(b) <= 12 && a !== b) {
      warn(`${label}: ambiguous date "${s}" read as ${day}/${mon}/${y} (day-first)`);
    }
    const iso = `${y}-${mon}-${day}T${String(hour).padStart(2, '0')}:${mi}:${se}${TZ_OFFSET}`;
    const d = new Date(iso);
    return isNaN(d) ? (warn(`${label}: unparseable "${s}"`), null) : d.toISOString();
  }

  const d = new Date(s);
  if (!isNaN(d)) {
    warn(`${label}: fell back to Date() for "${s}"`);
    return d.toISOString();
  }

  warn(`${label}: unparseable "${s}"`);
  return null;
}

const toArray = (v) =>
  String(v ?? '')
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter(Boolean);

// ── transforms ──────────────────────────────────────────

function buildApplications(rows) {
  const seen = new Set();
  const out = [];

  rows.forEach((r, i) => {
    const id = pick(r, ['applicationid', 'applicationid1', 'id']);
    if (!id) {
      warn(`applications row ${i + 2}: no Application ID, skipped`);
      return;
    }
    if (seen.has(id)) {
      warn(`applications row ${i + 2}: duplicate Application ID "${id}", skipped`);
      return;
    }
    seen.add(id);

    const submitted = toTimestamp(pick(r, ['timestamp', 'submittedat']), `applications[${id}].timestamp`);

    out.push({
      application_id: id,
      submitted_at: submitted ?? new Date().toISOString(),
      full_name: pick(r, ['fullname', 'name']),
      ic_number: nullIfBlank(stripQuote(pick(r, ['icnumber', 'ic']))),
      email: pick(r, ['email']),
      phone: nullIfBlank(stripQuote(pick(r, ['phone']))),
      address: nullIfBlank(pick(r, ['address'])),
      city: nullIfBlank(pick(r, ['city'])),
      state: nullIfBlank(pick(r, ['state'])),
      postcode: nullIfBlank(pick(r, ['postcode'])),
      position: pick(r, ['position']),
      available_date: nullIfBlank(pick(r, ['availabledate', 'availablefrom'])),
      expected_salary: nullIfBlank(pick(r, ['expectedsalary'])),
      experience: nullIfBlank(pick(r, ['experience'])),
      cover_message: nullIfBlank(pick(r, ['covermessage', 'message'])),
      resume_file_name: nullIfBlank(pick(r, ['resumefilename'])),
      resume_url: nullIfBlank(pick(r, ['resumeurl', 'resumelink'])),
      preferred_state: nullIfBlank(pick(r, ['preferredstate'])),
      preferred_branch: pick(r, ['preferredbranch', 'branch']),
      relocation: nullIfBlank(pick(r, ['relocation'])),
      stage: pick(r, ['stage', 'status']) || 'Applied',
      rating: toInt(pick(r, ['rating']), 0),
      tags: toArray(pick(r, ['tags'])),
      last_activity:
        toTimestamp(pick(r, ['lastactivity']), `applications[${id}].lastactivity`) ??
        submitted ??
        new Date().toISOString(),
      // Blank means "not archived". Any value is a real archive stamp —
      // this is the column whose text-vs-timestamp ambiguity caused the
      // silent archive no-op in the Apps Script version.
      archived_at: toTimestamp(pick(r, ['archived', 'archivedat']), `applications[${id}].archived`)
    });
  });

  return out;
}

function buildUsers(rows) {
  return rows
    .filter((r) => pick(r, ['email']))
    .map((r) => {
      const locations = toArray(pick(r, ['locations', 'allowedbranches', 'branches']));
      return {
        email: pick(r, ['email']),
        name: pick(r, ['name']) || pick(r, ['email']),
        role: pick(r, ['role']) || 'Viewer',
        // NULL means every branch. Role scoping was previously removed
        // as over-engineering, so the default has to stay permissive
        // until the API layer actually enforces it.
        allowed_branches: locations.length ? locations : null,
        active: toBool(pick(r, ['active']))
      };
    });
}

function buildSettings(rows) {
  return rows
    .filter((r) => pick(r, ['category']) && pick(r, ['value']))
    .map((r, i) => ({
      category: pick(r, ['category']),
      value: pick(r, ['value']),
      active: toBool(pick(r, ['active'])),
      sort_order: toInt(pick(r, ['sort', 'sortorder']), i)
    }));
}

function buildAuditLog(rows, validIds) {
  const out = [];

  rows.forEach((r, i) => {
    const appId = pick(r, ['applicationid']);
    if (appId && !validIds.has(appId)) {
      warn(`auditlog row ${i + 2}: application "${appId}" not found, application_id nulled`);
    }

    // The sheet crams both into one cell: "Jane Tan (jane@x.com)".
    const raw = pick(r, ['user', 'username']);
    const m = raw.match(/^(.*?)\s*\(([^)]+)\)\s*$/);

    out.push({
      created_at: toTimestamp(pick(r, ['timestamp']), `auditlog[${i + 2}].timestamp`) ?? new Date().toISOString(),
      user_name: m ? m[1].trim() : nullIfBlank(raw),
      user_email: m ? m[2].trim() : null,
      action: pick(r, ['action']) || 'UNKNOWN',
      application_id: appId && validIds.has(appId) ? appId : null,
      remarks: nullIfBlank(pick(r, ['remarks']))
    });
  });

  return out;
}

function buildInterviews(rows, validIds) {
  const out = [];

  rows.forEach((r, i) => {
    const appId = pick(r, ['applicationid']);
    if (!appId || !validIds.has(appId)) {
      warn(`interviews row ${i + 2}: application "${appId || '(blank)'}" not found, skipped`);
      return;
    }

    out.push({
      application_id: appId,
      candidate_name: nullIfBlank(pick(r, ['candidatename'])),
      title: pick(r, ['title']) || 'Interview',
      interviewer: nullIfBlank(pick(r, ['interviewer'])),
      interviewer_role: nullIfBlank(pick(r, ['interviewerrole'])),
      scheduled_at:
        toTimestamp(pick(r, ['scheduledat']), `interviews[${i + 2}].scheduledat`) ??
        new Date().toISOString(),
      duration_minutes: toInt(pick(r, ['durationminutes']), 45),
      type: pick(r, ['type']) || 'Interview',
      status: pick(r, ['status']) || 'Scheduled',
      meeting_link: nullIfBlank(pick(r, ['meetinglink'])),
      created_by: nullIfBlank(pick(r, ['createdby'])),
      created_at: toTimestamp(pick(r, ['createdat']), `interviews[${i + 2}].createdat`) ?? new Date().toISOString()
    });
  });

  return out;
}

function buildAssessments(rows, validIds) {
  const out = [];

  rows.forEach((r, i) => {
    const appId = pick(r, ['applicationid']);
    if (!appId || !validIds.has(appId)) {
      warn(`assessments row ${i + 2}: application "${appId || '(blank)'}" not found, skipped`);
      return;
    }

    out.push({
      application_id: appId,
      criterion: pick(r, ['criterion']) || 'Unspecified',
      score: toInt(pick(r, ['score']), 0),
      comment: nullIfBlank(pick(r, ['comment'])),
      assessor: nullIfBlank(pick(r, ['assessor'])),
      assessor_email: nullIfBlank(pick(r, ['assessoremail'])),
      assessed_at: toTimestamp(pick(r, ['assessedat']), `assessments[${i + 2}].assessedat`) ?? new Date().toISOString()
    });
  });

  return out;
}

// ── insert ──────────────────────────────────────────────

async function insert(table, rows) {
  if (!rows.length) return { table, inserted: 0 };

  const CHUNK = 500;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);

    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(batch)
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${table} batch at row ${i}: HTTP ${res.status} — ${body.slice(0, 400)}`);
    }

    inserted += batch.length;
    process.stdout.write(`  ${table}: ${inserted}/${rows.length}\r`);
  }

  process.stdout.write(' '.repeat(50) + '\r');
  return { table, inserted };
}

// ── run ─────────────────────────────────────────────────

async function run() {
  if (!existsSync(dataDir)) {
    fail(
      `migration-data/ not found.\n\n  Create it and export these tabs as CSV:\n` +
        `    applications.csv  users.csv  settings.csv\n` +
        `    auditlog.csv      interviews.csv  assessments.csv`
    );
  }

  console.log(`\n  Files in migration-data/: ${readdirSync(dataDir).join(', ') || '(none)'}`);

  const rawApps = readTable('applications.csv');
  if (!rawApps) fail('migration-data/applications.csv is required.');

  const applications = buildApplications(rawApps);
  const validIds = new Set(applications.map((a) => a.application_id));

  const users = buildUsers(readTable('users.csv') ?? []);
  const settings = buildSettings(readTable('settings.csv') ?? []);
  const auditLog = buildAuditLog(readTable('auditlog.csv') ?? [], validIds);
  const interviews = buildInterviews(readTable('interviews.csv') ?? [], validIds);
  const assessments = buildAssessments(readTable('assessments.csv') ?? [], validIds);

  // applications first — the other three carry FKs into it.
  const plan = [
    ['applications', applications],
    ['users', users],
    ['settings', settings],
    ['audit_log', auditLog],
    ['interviews', interviews],
    ['assessments', assessments]
  ];

  console.log(`\n  Parsed\n  ${'─'.repeat(58)}`);
  for (const [table, rows] of plan) {
    console.log(`  ${table.padEnd(14)} ${String(rows.length).padStart(5)} rows`);
  }

  const archived = applications.filter((a) => a.archived_at).length;
  const tagged = applications.filter((a) => a.tags.length).length;
  const rated = applications.filter((a) => a.rating > 0).length;
  console.log(
    `\n  Spot check: ${archived} archived, ${tagged} tagged, ${rated} rated,\n` +
      `  ${new Set(applications.map((a) => a.stage)).size} distinct stages ` +
      `(${[...new Set(applications.map((a) => a.stage))].join(', ')})`
  );

  // Counts alone don't prove the values converted correctly — this
  // shows the first row of each table exactly as it would be sent.
  if (DUMP) {
    console.log(`\n  First row of each table\n  ${'─'.repeat(58)}`);
    for (const [table, rows] of plan) {
      console.log(`\n  ${table}:`);
      console.log(rows.length ? JSON.stringify(rows[0], null, 2).replace(/^/gm, '    ') : '    (empty)');
    }
  }

  if (warnings.length) {
    const show = warnings.slice(0, 25);
    console.log(`\n  Warnings (${warnings.length})\n  ${'─'.repeat(58)}`);
    show.forEach((w) => console.log(`  • ${w}`));
    if (warnings.length > show.length) console.log(`  … ${warnings.length - show.length} more`);
  }

  if (!COMMIT) {
    console.log(
      `\n  DRY RUN — nothing written.\n\n` +
        `  Review the counts and warnings above, then re-run with --commit\n`
    );
    return;
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    fail('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local');
  }

  console.log(`\n  Inserting into ${SUPABASE_URL}\n  ${'─'.repeat(58)}`);

  for (const [table, rows] of plan) {
    const { inserted } = await insert(table, rows);
    console.log(`  [  OK  ] ${table.padEnd(14)} ${inserted} rows`);
  }

  console.log(`\n  MIGRATION COMPLETE\n`);
}

run().catch((err) => {
  console.error(`\n  Migration failed: ${err.message}\n`);
  process.exitCode = 1;
});
