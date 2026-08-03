/**
 * Tests the DEPLOYED app, not Apps Script directly.
 *
 *   node scripts/check-deploy.mjs https://your-app.vercel.app you@company.com
 *
 * preflight.mjs calls Apps Script straight from your machine using
 * .env.local, so it passes even when Vercel is misconfigured. This
 * goes through the deployed /api/gas proxy instead, which is where
 * the environment variables actually matter.
 */

const [baseUrlRaw, userEmail] = process.argv.slice(2);

if (!baseUrlRaw || !userEmail) {
  console.log('\n  Usage: node scripts/check-deploy.mjs <vercel-url> <email>\n');
  process.exitCode = 1;
} else {
  const baseUrl = baseUrlRaw.replace(/\/+$/, '');
  run(baseUrl, userEmail);
}

async function run(baseUrl, userEmail) {
  console.log(`\n  Checking ${baseUrl}\n  ${'─'.repeat(58)}`);

  // 1. Does the site itself load?
  try {
    const res = await fetch(baseUrl, { redirect: 'follow' });
    const html = await res.text();
    if (res.ok && /<div id="root">/.test(html)) {
      console.log('  [  OK  ] Site loads (SPA shell present)');
    } else if (res.status === 401 || /authenticat/i.test(html)) {
      console.log('  [ WARN ] Site is behind Vercel Deployment Protection');
      console.log('           Disable it, or the check below will fail too.');
    } else {
      console.log(`  [ FAIL ] Site returned HTTP ${res.status}`);
    }
  } catch (err) {
    console.log(`  [ FAIL ] Site unreachable — ${err.message}`);
    return done(1);
  }

  // 2. Does the serverless function exist and work?
  const url = `${baseUrl}/api/gas?action=bootstrap&user=${encodeURIComponent(userEmail)}`;
  let res, text;

  try {
    res = await fetch(url, { redirect: 'follow' });
    text = await res.text();
  } catch (err) {
    console.log(`  [ FAIL ] /api/gas unreachable — ${err.message}`);
    return done(1);
  }

  if (res.status === 404) {
    console.log('  [ FAIL ] /api/gas returned 404 — the function did not deploy');
    console.log('           Check that api/gas.ts is in the repo and Root Directory is "./"');
    return done(1);
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    console.log(`  [ FAIL ] /api/gas returned non-JSON (HTTP ${res.status})`);
    console.log(`           ${text.slice(0, 200).replace(/\s+/g, ' ')}`);
    return done(1);
  }

  if (json.result === 'success') {
    console.log('  [  OK  ] /api/gas reachable');
    console.log(`  [  OK  ] Login works — ${json.user?.name} (${json.user?.role})`);
    const stages = json.settings?.Stage || json.settings?.Status || [];
    console.log(`  [  OK  ] Stages (${stages.length}): ${stages.join(' → ')}`);
    return done(0, 'DEPLOYMENT HEALTHY');
  }

  // 3. Translate the failure into the actual fix.
  const msg = String(json.message || '');
  console.log(`  [ FAIL ] ${msg}`);

  // parseUpstream attaches what Apps Script actually returned. This is
  // usually the whole diagnosis — a Google 404 page, a sign-in page, etc.
  if (json.raw) {
    console.log('');
    console.log('  RAW RESPONSE FROM APPS SCRIPT:');
    console.log(`  ${String(json.raw).replace(/\s+/g, ' ').slice(0, 280)}`);
  }

  console.log('');

  if (/are not set/i.test(msg)) {
    console.log('  CAUSE: GAS_URL / GAS_TOKEN did not reach the running deployment.');
    console.log('  FIX:   1. Confirm both exist in the project settings, with no VITE_ prefix,');
    console.log('            and are set for the PRODUCTION environment (not just Preview).');
    console.log('         2. Redeploy. Adding a variable does NOT apply it to a deployment');
    console.log('            that already ran — Cloudflare Pages: Deployments → ⋯ → Retry;');
    console.log('            Vercel: Deployments → ⋯ → Redeploy.');
  } else if (/unauthor/i.test(msg)) {
    console.log('  CAUSE: GAS_TOKEN in Vercel != DASHBOARD_TOKEN in Config.gs.');
    console.log('  FIX:   Re-copy the value from .env.local WITHOUT the surrounding');
    console.log('         quotes, check for a trailing space, then redeploy.');
  } else if (/non-JSON|Execute as/i.test(msg)) {
    console.log('  CAUSE: Apps Script answered with HTML instead of JSON. Read the raw');
    console.log('         response above — it names which of these it is:');
    console.log('           "Page Not Found"      -> GAS_URL wrong or deployment deleted');
    console.log('           "Sign in" / accounts  -> access is not set to "Anyone"');
    console.log('           "Moved Temporarily"   -> redirect was not followed');
    console.log('           "Script function..."  -> the script threw before responding');
  } else if (/not registered|inactive/i.test(msg)) {
    console.log(`  CAUSE: "${userEmail}" is not an active row in the Users sheet.`);
    console.log('  FIX:   Check spelling and that Active is 1/TRUE/Yes.');
  }

  done(1);
}

function done(code, banner) {
  console.log(`  ${'─'.repeat(58)}`);
  if (banner) console.log(`\n  ${banner}\n`);
  else console.log('');
  process.exitCode = code;
}
