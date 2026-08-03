import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Server-side proxy to the Google Apps Script web app.
 *
 * The browser never sees GAS_TOKEN or GAS_URL — it calls /api/gas and
 * this function injects them. Without this hop the token would ship
 * inside the JS bundle and anyone could read the applicant sheet.
 *
 * Required Vercel environment variables (no VITE_ prefix — that would
 * expose them to the client):
 *   GAS_URL    https://script.google.com/macros/s/AKfy.../exec
 *   GAS_TOKEN  same string as DASHBOARD_TOKEN in Config.gs
 *
 * NOTE: this file deliberately has NO relative imports. package.json
 * sets "type": "module", so Node's ESM resolver on Vercel rejects an
 * extensionless import like `./_forward` and the whole function fails
 * to load — every route returning FUNCTION_INVOCATION_FAILED. Vite
 * bundles the config locally and hides the problem, so keep `forward`
 * here and let vite.config.ts import it from this file.
 */

const READ_ACTIONS = ['bootstrap', 'applications', 'activity', 'interviews', 'assessments'];

const WRITE_ACTIONS = [
  'login',
  'updateStage',
  'addNote',
  'updateTags',
  'scheduleInterview',
  'saveAssessment'
];

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

      // Apps Script intermittently answers the googleusercontent
      // redirect with a 404 HTML page instead of JSON. Reads are
      // idempotent, so retry rather than surfacing a spurious error.
      return { status: 200, body: await fetchJsonWithRetry(`${GAS_URL}?${params.toString()}`) };
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
 * GET with retry.
 *
 * Apps Script routes /exec through a one-time redirect to
 * script.googleusercontent.com, and that hop intermittently returns a
 * Google 404 page instead of the script's JSON — roughly one request in
 * a few dozen, unrelated to the deployment being healthy. Reads are
 * idempotent so a retry is safe and invisible to the user.
 *
 * Deliberately NOT used for POST: a write that appears to fail may
 * already have hit the sheet, and retrying would duplicate the row.
 */
async function fetchJsonWithRetry(url: string, attempts = 3) {
  let last: unknown = null;

  for (let i = 0; i < attempts; i++) {
    const upstream = await fetch(url, { redirect: 'follow' });
    const parsed = await parseUpstream(upstream);

    // A real script response always carries `result`. The synthetic
    // error object from parseUpstream carries `raw`.
    if (!(parsed && typeof parsed === 'object' && 'raw' in parsed)) {
      return parsed;
    }

    last = parsed;
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }

  return last;
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const body =
    typeof req.body === 'string' ? safeParse(req.body) : (req.body as Record<string, unknown>) || null;

  const { status, body: payload } = await forward(req.method || 'GET', req.query, body, {
    GAS_URL: process.env.GAS_URL,
    GAS_TOKEN: process.env.GAS_TOKEN
  });

  res.status(status).json(payload);
}

function safeParse(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text || '{}');
  } catch {
    return {};
  }
}
