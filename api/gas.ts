import type { VercelRequest, VercelResponse } from '@vercel/node';
import { forward } from './_forward';

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
 */
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
