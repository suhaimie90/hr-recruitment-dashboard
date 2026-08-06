/**
 * Cloudflare Pages Function — starts the Google sign-in redirect.
 *
 * Serves /api/auth/login. GET only: this is a plain link/navigation
 * from LoginScreen, not a fetch call.
 */

import { Env, randomState, stateSetCookie } from '../../../lib/auth';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;

  if (!env.GOOGLE_CLIENT_ID) {
    return new Response('GOOGLE_CLIENT_ID is not set on this deployment.', { status: 500 });
  }

  const url = new URL(request.url);
  // Same origin the browser is actually on (preview URL, custom domain,
  // localhost) — must exactly match an Authorized redirect URI
  // registered on the Google OAuth client.
  const redirectUri = `${url.origin}/api/auth/callback`;
  const state = randomState();

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account'
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${GOOGLE_AUTH_URL}?${params.toString()}`,
      'Set-Cookie': stateSetCookie(state)
    }
  });
}
