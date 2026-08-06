/**
 * Cloudflare Pages Function — Google's redirect target after consent.
 *
 * Serves /api/auth/callback. Exchanges the code for an id_token,
 * validates it, checks the email against the Supabase `users` table
 * (the authorization allowlist — unchanged from the old email-login
 * flow), and either mints a session cookie or bounces back with an
 * error the SPA can show. There is no client-side router, so both
 * outcomes redirect to "/" with an optional "?error=" query param.
 */

import {
  Env,
  decodeIdTokenPayload,
  lookupUser,
  sessionSetCookie,
  signSession,
  stateClearCookie,
  stateCookieFromRequest
} from '../../../lib/auth';

function buildRedirect(location: string, cookies: string[]): Response {
  const headers = new Headers({ Location: location });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 302, headers });
}

function isAuthorizedIdToken(
  claims: Record<string, unknown>,
  clientId: string
): claims is { email: string } {
  const iss = String(claims.iss || '');
  const aud = String(claims.aud || '');
  const exp = Number(claims.exp || 0);

  return (
    (iss === 'https://accounts.google.com' || iss === 'accounts.google.com') &&
    aud === clientId &&
    exp * 1000 > Date.now() &&
    claims.email_verified === true &&
    typeof claims.email === 'string' &&
    claims.email.length > 0
  );
}

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.SESSION_SECRET) {
    return new Response('OAuth is not configured on this deployment.', { status: 500 });
  }

  const redirectToError = (error: string) =>
    buildRedirect(`${url.origin}/?error=${error}`, [stateClearCookie()]);

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  // CSRF check: the state Google echoes back must match the one this
  // browser was given in login.ts's short-lived cookie.
  if (!code || !state || state !== stateCookieFromRequest(request)) {
    return redirectToError('oauth_failed');
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        // Must exactly match the redirect_uri used in login.ts.
        redirect_uri: `${url.origin}/api/auth/callback`,
        grant_type: 'authorization_code'
      })
    });

    const tokenJson = (await tokenRes.json()) as { id_token?: string };
    if (!tokenRes.ok || !tokenJson.id_token) return redirectToError('oauth_failed');

    const claims = decodeIdTokenPayload(tokenJson.id_token);
    if (!isAuthorizedIdToken(claims, env.GOOGLE_CLIENT_ID)) return redirectToError('oauth_failed');

    // Google verified WHO signed in; this decides whether they're
    // allowed in — same allowlist check the old email-only login did.
    const user = await lookupUser(env, claims.email);
    if (!user) return redirectToError('unauthorized_user');

    const session = await signSession(user.email, env);
    return buildRedirect(`${url.origin}/`, [sessionSetCookie(session), stateClearCookie()]);
  } catch (err) {
    console.error('OAuth callback failed:', err);
    return redirectToError('oauth_failed');
  }
}
