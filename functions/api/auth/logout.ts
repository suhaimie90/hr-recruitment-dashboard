/**
 * Cloudflare Pages Function — clears the session cookie.
 *
 * Serves /api/auth/logout. POST only, called via fetch from the app
 * (see src/services/api.ts's logout()).
 */

import { sessionClearCookie } from '../../../lib/auth';

export async function onRequest(context: { request: Request }): Promise<Response> {
  if (context.request.method !== 'POST') {
    return new Response(JSON.stringify({ result: 'error', message: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ result: 'success' }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': sessionClearCookie()
    }
  });
}
