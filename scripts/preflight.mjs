/** Read-only configuration check for the public portfolio demo. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let env;
try {
  env = Object.fromEntries(
    readFileSync(join(root, '.env.local'), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const equals = line.indexOf('=');
        return [
          line.slice(0, equals).trim(),
          line.slice(equals + 1).trim().replace(/^["']|["']$/g, '')
        ];
      })
  );
} catch {
  console.error('\n  FAIL  .env.local was not found. Copy .env.example first.\n');
  process.exit(1);
}

const required = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DEMO_EMAIL',
  'DEMO_PASSWORD',
  'SESSION_SECRET'
];
const missing = required.filter((key) => !env[key]);
const placeholders = required.filter((key) => /replace-with|YOUR_PROJECT/i.test(env[key] || ''));
const demoMode = /^(1|true|yes)$/i.test(env.DEMO_MODE || '');

console.log('\n  TalentFlow public-demo preflight\n  ' + '─'.repeat(48));
for (const key of required) {
  console.log(`  ${missing.includes(key) || placeholders.includes(key) ? 'FAIL' : ' OK '}  ${key}`);
}
console.log(`  ${demoMode ? ' OK ' : 'FAIL'}  DEMO_MODE=true`);
console.log('  ' + '─'.repeat(48));

if (missing.length || placeholders.length || !demoMode) {
  console.error('\n  NOT READY — fix the failed configuration entries.\n');
  process.exitCode = 1;
} else {
  console.log('\n  CONFIGURATION READY\n');
}
