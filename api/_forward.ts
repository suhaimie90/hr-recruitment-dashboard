/**
 * Shared forwarding logic between the Vercel serverless function
 * (production) and the Vite dev middleware (local). Keeping it in one
 * place means local behaviour can't drift from deployed behaviour.
 */

const READ_ACTIONS = ['bootstrap', 'applications', 'activity', 'interviews'];

const WRITE_ACTIONS = ['login', 'updateStage', 'addNote', 'updateTags', 'scheduleInterview'];

export interface ForwardResult {
  status: number;
  body: unknown;
}

export async function forward(
  method: string,
  query: Record<string, string | string[] | undefined>,
  body: Record<string, unknown> | null,
  env: { GAS_URL?: string; GAS_TOKEN?: string }
): Promise<ForwardResult> {
  const { GAS_URL, GAS_TOKEN } = env;

  if (!GAS_URL || !GAS_TOKEN) {
    return {
      status: 500,
      body: {
        result: 'error',
        message:
          'GAS_URL and GAS_TOKEN are not set. Add them to .env.local for local dev, ' +
          'or to the Vercel project environment for deployments.'
      }
    };
  }

  try {
    if (method === 'GET') {
      const action = String(query.action || '');

      if (!READ_ACTIONS.includes(action)) {
        return { status: 400, body: { result: 'error', message: `Unsupported action: ${action}` } };
      }

      const params = new URLSearchParams();
      params.set('token', GAS_TOKEN);

      // Caller params are forwarded, but never allowed to override the token.
      for (const [key, value] of Object.entries(query)) {
        if (key === 'token' || value == null) continue;
        params.set(key, Array.isArray(value) ? value[0] : String(value));
      }

      const upstream = await fetch(`${GAS_URL}?${params.toString()}`, { redirect: 'follow' });
      return { status: 200, body: await parseUpstream(upstream) };
    }

    if (method === 'POST') {
      const payload = body || {};
      const action = String(payload.action || '');

      if (!WRITE_ACTIONS.includes(action)) {
        return { status: 400, body: { result: 'error', message: `Unsupported action: ${action}` } };
      }

      // Apps Script has no OPTIONS handler, so an application/json
      // content-type would trigger a CORS preflight and fail. text/plain
      // is the standard workaround and is what the public form uses too.
      const upstream = await fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...payload, token: GAS_TOKEN }),
        redirect: 'follow'
      });

      return { status: 200, body: await parseUpstream(upstream) };
    }

    return { status: 405, body: { result: 'error', message: 'Method not allowed' } };
  } catch (err) {
    return {
      status: 502,
      body: {
        result: 'error',
        message: `Apps Script request failed: ${err instanceof Error ? err.message : String(err)}`
      }
    };
  }
}

/**
 * Apps Script answers with an HTML error page when the deployment is
 * misconfigured or the script throws before ContentService runs.
 * A raw JSON parse error would be useless, so translate it.
 */
async function parseUpstream(upstream: Response) {
  const text = await upstream.text();

  try {
    return JSON.parse(text);
  } catch {
    return {
      result: 'error',
      message:
        'Apps Script returned a non-JSON response. Check that the deployment uses ' +
        '"Execute as: Me" and "Who has access: Anyone", and that you deployed a NEW version.',
      raw: text.slice(0, 300)
    };
  }
}
