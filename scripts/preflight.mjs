/**
 * Go-live preflight check.
 *
 *   npm run preflight -- you@company.com
 *
 * Calls the real Apps Script deployment and reports what is and isn't
 * ready. Reads GAS_URL / GAS_TOKEN from .env.local — the token is never
 * printed. Read-only: it makes no writes to the sheet.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const results = [];
function ok(msg, detail) { results.push(['PASS', msg, detail]); }
function warn(msg, detail) { results.push(['WARN', msg, detail]); }
function fail(msg, detail) { results.push(['FAIL', msg, detail]); }

// ── Load .env.local ─────────────────────────────────────
let env = {};
try {
  env = Object.fromEntries(
    readFileSync(join(root, '.env.local'), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const eq = line.indexOf('=');
        return [line.slice(0, eq).trim(), line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')];
      })
  );
} catch {
  console.log('\n  .env.local not found in hr-recruitment-dashboard/');
  console.log('\n  Create it with:\n');
  console.log('    GAS_URL="https://script.google.com/macros/s/YOUR_ID/exec"');
  console.log('    GAS_TOKEN="same string as DASHBOARD_TOKEN in Config.gs"\n');
  process.exit(1);
}

const { GAS_URL, GAS_TOKEN } = env;
const userEmail = process.argv[2] || env.PREFLIGHT_USER;

async function callGet(action, params = {}) {
  const query = new URLSearchParams({ action, token: GAS_TOKEN, user: userEmail, ...params });
  const res = await fetch(`${GAS_URL}?${query}`, { redirect: 'follow' });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 160)}`);
  }
}

async function run() {
  // 1. Config present
  if (!GAS_URL || !GAS_TOKEN) {
    fail('GAS_URL / GAS_TOKEN missing from .env.local');
    return report();
  }
  if (!/\/exec$/.test(GAS_URL)) {
    fail('GAS_URL must end in /exec', `got: …${GAS_URL.slice(-12)}`);
    return report();
  }
  ok('GAS_URL and GAS_TOKEN are set');

  if (!userEmail) {
    fail('No user email given', 'run: npm run preflight -- you@company.com');
    return report();
  }

  // 2. Reachable + token accepted
  let bootstrap;
  try {
    bootstrap = await callGet('bootstrap');
  } catch (err) {
    fail('Apps Script unreachable or not returning JSON', err.message);
    return report();
  }

  if (bootstrap.result !== 'success') {
    const msg = String(bootstrap.message || '');
    if (/unauthor/i.test(msg)) {
      fail('Token rejected', 'GAS_TOKEN ≠ DASHBOARD_TOKEN, or no new version deployed');
    } else if (/not registered|inactive/i.test(msg)) {
      fail(`User "${userEmail}" rejected`, msg);
    } else {
      fail('bootstrap failed', msg);
    }
    return report();
  }
  ok('Endpoint reachable and token accepted');
  ok(`Login works — ${bootstrap.user?.name} (${bootstrap.user?.role})`);

  // 3. Wrong token must be refused
  try {
    const bad = await (async () => {
      const q = new URLSearchParams({ action: 'bootstrap', token: 'definitely-wrong', user: userEmail });
      const r = await fetch(`${GAS_URL}?${q}`, { redirect: 'follow' });
      return JSON.parse(await r.text());
    })();
    if (bad.result === 'success') {
      fail('SECURITY: a wrong token was accepted', 'requireToken_ is not running — do not go live');
    } else {
      ok('Wrong token is rejected');
    }
  } catch {
    warn('Could not complete the bad-token check');
  }

  // 4. Settings / stages
  const settings = bootstrap.settings || {};
  const stages = settings.Stage || settings.Status || [];
  if (!stages.length) {
    fail('No pipeline stages in Settings', 'need rows with Category "Stage" or "Status" and Active truthy');
  } else {
    ok(`Pipeline stages (${stages.length})`, stages.join(' → '));
  }

  // 5. Applications
  let apps = [];
  try {
    const res = await callGet('applications');
    if (res.result !== 'success') throw new Error(res.message);
    apps = res.data || [];
    ok(`Applications readable (${apps.length} rows)`);
  } catch (err) {
    fail('Could not read applications', err.message);
    return report();
  }

  if (apps.length) {
    const filled = (key) => apps.filter((a) => String(a[key] ?? '').trim()).length;
    const check = (key, label) => {
      const n = filled(key);
      if (n === 0) fail(`${label}: empty on all ${apps.length} rows`, `column name mismatch?`);
      else if (n < apps.length) warn(`${label}: filled on ${n}/${apps.length} rows`);
      else ok(`${label}: present on all rows`);
    };

    check('fullName', 'Full Name');
    check('email', 'Email');
    check('resumeUrl', 'Resume link');
    check('position', 'Position');
    check('preferredBranch', 'Preferred Branch');

    // Stage must map to a real Kanban column, or cards render nowhere.
    const orphans = [...new Set(apps.map((a) => a.stage).filter((s) => s && !stages.includes(s)))];
    if (orphans.length) {
      fail(
        `${orphans.length} stage value(s) have no Kanban column`,
        `${orphans.join(', ')} — not in Settings, these cards are invisible on the board`
      );
    } else if (stages.length) {
      ok('Every application maps to a valid stage column');
    }
  } else {
    warn('No application rows yet', 'nothing to display on the board');
  }

  // 6. Interviews sheet
  try {
    const res = await callGet('interviews');
    if (res.result === 'success') ok(`Interviews sheet reachable (${(res.data || []).length} rows)`);
    else warn('Interviews sheet unavailable', `${res.message} — scheduling will fail, rest still works`);
  } catch (err) {
    warn('Interviews sheet unavailable', err.message);
  }

  report();
}

function report() {
  const icon = { PASS: '  OK  ', WARN: ' WARN ', FAIL: ' FAIL ' };
  console.log('\n  Go-live preflight\n  ' + '─'.repeat(58));
  for (const [status, msg, detail] of results) {
    console.log(`  [${icon[status]}] ${msg}`);
    if (detail) console.log(`            ${detail}`);
  }

  const failed = results.filter((r) => r[0] === 'FAIL').length;
  const warned = results.filter((r) => r[0] === 'WARN').length;

  console.log('  ' + '─'.repeat(58));

  // exitCode rather than exit() — lets open sockets close cleanly,
  // which Windows asserts on otherwise.
  if (failed) {
    console.log(`\n  NOT READY — ${failed} blocker(s), ${warned} warning(s)\n`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n  READY TO DEPLOY${warned ? ` — ${warned} warning(s) worth a look` : ''}\n`);
}

run().catch((err) => {
  console.error('\n  Preflight crashed:', err.message, '\n');
  process.exitCode = 1;
});
