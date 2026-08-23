/**
 * Read-only health check for a deployed public demo.
 *
 * node scripts/check-deploy.mjs <url> [email] [password]
 */

const [baseUrlRaw, email = 'demo@talentflow.app', password = 'TalentFlowDemo!'] =
  process.argv.slice(2);

if (!baseUrlRaw) {
  console.error('\n  Usage: node scripts/check-deploy.mjs <url> [email] [password]\n');
  process.exit(1);
}

const baseUrl = baseUrlRaw.replace(/\/+$/, '');

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${response.status} returned non-JSON: ${text.slice(0, 120)}`);
  }
}

async function run() {
  console.log(`\n  Checking ${baseUrl}\n  ${'─'.repeat(52)}`);

  const shell = await fetch(baseUrl, { redirect: 'follow' });
  const html = await shell.text();
  if (!shell.ok || !/<div id="root">/.test(html)) {
    throw new Error(`SPA shell failed with HTTP ${shell.status}`);
  }
  console.log('  [ OK ] SPA shell loads');

  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    redirect: 'manual'
  });
  const login = await readJson(loginResponse);
  if (!loginResponse.ok || login.result !== 'success') {
    throw new Error(login.message || `Login failed with HTTP ${loginResponse.status}`);
  }
  console.log(`  [ OK ] Demo login works (${login.user?.role || 'unknown role'})`);

  const cookie = loginResponse.headers.get('set-cookie');
  if (!cookie) throw new Error('Login did not return a session cookie');
  const sessionCookie = cookie.split(';', 1)[0];

  const bootstrapResponse = await fetch(`${baseUrl}/api/data?action=bootstrap`, {
    headers: { Cookie: sessionCookie }
  });
  const bootstrap = await readJson(bootstrapResponse);
  if (bootstrap.result !== 'success') throw new Error(bootstrap.message || 'Bootstrap failed');
  console.log('  [ OK ] JWT session authorizes /api/data');

  const applicationsResponse = await fetch(`${baseUrl}/api/data?action=applications`, {
    headers: { Cookie: sessionCookie }
  });
  const applications = await readJson(applicationsResponse);
  if (applications.result !== 'success') throw new Error(applications.message || 'Data read failed');
  console.log(`  [ OK ] Synthetic applications readable (${applications.data?.length || 0})`);
  console.log(`  ${'─'.repeat(52)}\n\n  DEPLOYMENT HEALTHY\n`);
}

run().catch((error) => {
  console.error(`\n  [FAIL] ${error.message}\n`);
  process.exitCode = 1;
});
