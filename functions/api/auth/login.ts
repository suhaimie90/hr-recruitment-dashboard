/**
 * Cloudflare Pages Function — authenticates the public demo account.
 *
 * Serves POST /api/auth/login. Credentials are deployment variables;
 * the issued JWT is stored in an HttpOnly cookie and never returned to
 * client-side JavaScript.
 */

import { Env, lookupUser, sessionSetCookie, signSession } from '../../../lib/auth';

function json(status: number, body: unknown, cookie?: string): Response {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cookie) headers['Set-Cookie'] = cookie;
  return new Response(JSON.stringify(body), { status, headers });
}

function sameValue(actual: string, expected: string): boolean {
  const a = new TextEncoder().encode(actual);
  const b = new TextEncoder().encode(expected);
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let i = 0; i < length; i++) difference |= (a[i] || 0) ^ (b[i] || 0);
  return difference === 0;
}

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return json(405, { result: 'error', message: 'Method not allowed' });
  }

  if (!/^(1|true|yes)$/i.test(String(env.DEMO_MODE || ''))) {
    return json(403, { result: 'error', message: 'Demo login is disabled.' });
  }

  if (!env.DEMO_EMAIL || !env.DEMO_PASSWORD || !env.SESSION_SECRET) {
    return json(500, { result: 'error', message: 'Demo login is not configured.' });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json(400, { result: 'error', message: 'Invalid request body' });
  }

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const expectedEmail = env.DEMO_EMAIL.trim().toLowerCase();

  if (!sameValue(email, expectedEmail) || !sameValue(password, env.DEMO_PASSWORD)) {
    return json(401, { result: 'error', message: 'Invalid demo email or password.' });
  }

  const user = await lookupUser(env, expectedEmail);
  if (!user) {
    return json(403, { result: 'error', message: 'The demo user is missing or inactive.' });
  }

  const token = await signSession(user.email, env);
  return json(200, { result: 'success', user }, sessionSetCookie(token));
}
