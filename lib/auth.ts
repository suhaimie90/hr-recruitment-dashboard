/**
 * Server-side auth helpers shared by the Cloudflare Pages Functions
 * under functions/api/auth/ and functions/api/data.ts.
 *
 * Lives outside functions/ on purpose: Cloudflare Pages Functions turns
 * every file under functions/ into a route, and Wrangler has a known
 * bug handling `_`-prefixed "not a route" directories there, so there
 * is no safe way to keep non-route helpers inside that tree. Imported
 * by relative path instead — the same cross-directory pattern
 * vite.config.ts already uses to import `forward` from functions/api/*.
 */

export interface Env {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /** Server-only Apps Script bridge used for Drive and Calendar. */
  GAS_URL?: string;
  GAS_TOKEN?: string;
  DEMO_EMAIL?: string;
  DEMO_PASSWORD?: string;
  DEMO_MODE?: string;
  SESSION_SECRET?: string;
}

export interface SessionUser {
  email: string;
  name: string;
  role: string;
  canEdit: boolean;
  canViewAnalytics: boolean;
  allowedBranches: string[];
  excludedBranches: string[];
  allowedPositions: string[];
}

const SESSION_COOKIE = 'th_session';
const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
const JWT_ISSUER = 'talentflow-demo';
const JWT_AUDIENCE = 'talentflow-dashboard';

const enc = encodeURIComponent;
const textEncoder = new TextEncoder();

// ── base64url ───────────────────────────────────────────

function b64urlEncode(bytes: Uint8Array): string {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(value: string): Uint8Array {
  const pad = (4 - (value.length % 4)) % 4;
  const str = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad));
  const arr = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i);
  return arr;
}

// ── cookies ─────────────────────────────────────────────

export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;

  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }

  return out;
}

function buildCookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${enc(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

// ── HS256 JWT session signing ───────────────────────────
//
// Workers' built-in Web Crypto already implements HMAC-SHA256, so a
// JWT dependency would add bundle weight without improving this small,
// fixed algorithm implementation. The token is never exposed to the
// React app; it travels only in the HttpOnly session cookie.

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

/** Issues a compact HS256 JWT for the configured demo account. */
export async function signSession(email: string, env: Env): Promise<string> {
  if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET is not set');

  const now = Math.floor(Date.now() / 1000);
  const header = b64urlEncode(textEncoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = b64urlEncode(textEncoder.encode(JSON.stringify({
    sub: email,
    email,
    iat: now,
    exp: now + SESSION_MAX_AGE_SECONDS,
    iss: JWT_ISSUER,
    aud: JWT_AUDIENCE
  })));
  const signingInput = `${header}.${payload}`;

  const key = await hmacKey(env.SESSION_SECRET);
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(signingInput));

  return `${signingInput}.${b64urlEncode(new Uint8Array(signature))}`;
}

/**
 * Verifies the session cookie found in a raw `Cookie` request-header
 * string and returns the signed-in email, or null. Takes the whole
 * header (not a pre-extracted value) so every caller — the Pages
 * Function's `request.headers.get('Cookie')` or the Vite dev-server
 * proxy's equivalent — can pass it straight through unmodified.
 */
export async function verifySession(
  cookieHeader: string | null | undefined,
  env: Env
): Promise<string | null> {
  const cookieValue = parseCookies(cookieHeader)[SESSION_COOKIE];
  if (!cookieValue || !env.SESSION_SECRET) return null;

  const parts = cookieValue.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const signingInput = `${header}.${payload}`;

  try {
    const parsedHeader = JSON.parse(new TextDecoder().decode(b64urlDecode(header)));
    if (parsedHeader.alg !== 'HS256' || parsedHeader.typ !== 'JWT') return null;

    const key = await hmacKey(env.SESSION_SECRET);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      b64urlDecode(signature),
      textEncoder.encode(signingInput)
    );
    if (!valid) return null;

    const { sub, email, exp, iss, aud } = JSON.parse(
      new TextDecoder().decode(b64urlDecode(payload))
    );
    const now = Math.floor(Date.now() / 1000);
    if (
      typeof sub !== 'string' ||
      typeof email !== 'string' ||
      sub !== email ||
      typeof exp !== 'number' ||
      now >= exp ||
      iss !== JWT_ISSUER ||
      aud !== JWT_AUDIENCE
    ) return null;

    return email;
  } catch {
    // Malformed cookie (tampered, truncated, from an old SESSION_SECRET) —
    // treat exactly like "not signed in" rather than a 500.
    return null;
  }
}

export const sessionSetCookie = (value: string) => buildCookie(SESSION_COOKIE, value, SESSION_MAX_AGE_SECONDS);
export const sessionClearCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

// ── Supabase `users` table — the authorization allowlist ───
//
// The demo credential proves who signed in; this table remains the
// authorization allowlist and source of role/branch permissions.

export async function lookupUser(env: Env, email: string | null | undefined): Promise<SessionUser | null> {
  if (!email || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || normalizedEmail.length > 254) return null;

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/users?select=email,name,role,active,allowed_branches,excluded_branches,allowed_positions&email=eq.${enc(normalizedEmail)}&limit=1`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
      }
    }
  );

  if (!res.ok) return null;

  const rows = (await res.json()) as Array<Record<string, unknown>>;
  const match = rows[0];
  if (!match || !match.active) return null;

  const role = String(match.role || 'Viewer');
  const normalizedRole = role.trim().toLowerCase();
  const analyticsRoles = new Set([
    'admin',
    'manager',
    'area manager',
    'senior manager',
    'director',
    'strategic'
  ]);
  const stringArray = (value: unknown) =>
    (Array.isArray(value) ? value : []).map(String).map((item) => item.trim()).filter(Boolean);

  return {
    email: String(match.email).trim().toLowerCase(),
    name: String(match.name || match.email),
    role,
    canEdit: normalizedRole !== 'viewer',
    canViewAnalytics: analyticsRoles.has(normalizedRole),
    allowedBranches: stringArray(match.allowed_branches),
    excludedBranches: stringArray(match.excluded_branches),
    allowedPositions: stringArray(match.allowed_positions)
  };
}
