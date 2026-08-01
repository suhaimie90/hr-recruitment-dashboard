import { forward, type Env as ProxyEnv } from './forward';

/**
 * Cloudflare Worker entry point.
 *
 * Serves two things:
 *   /api/gas  — the Apps Script proxy, injecting GAS_URL / GAS_TOKEN
 *   *         — the built React app from the static-assets binding
 *
 * `run_worker_first` is set in wrangler.jsonc so every request reaches
 * this handler. Routing and SPA fallback are therefore explicit here
 * rather than depending on asset-router precedence rules.
 */

export interface Env extends ProxyEnv {
  /** Static assets binding — the contents of dist/ after `npm run build`. */
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/gas') {
      const query = Object.fromEntries(url.searchParams.entries());

      let body: Record<string, unknown> | null = null;

      if (request.method === 'POST') {
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }
      }

      const { status, body: payload } = await forward(request.method, query, body, env);

      return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Anything else is the SPA. Unknown paths fall back to index.html so
    // deep links and client-side routing work instead of 404ing.
    const asset = await env.ASSETS.fetch(request);

    if (asset.status === 404 && request.method === 'GET') {
      return env.ASSETS.fetch(new Request(new URL('/index.html', url), request));
    }

    return asset;
  }
};
