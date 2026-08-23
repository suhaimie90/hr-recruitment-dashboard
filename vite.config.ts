import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';
// Same implementation the deployed Pages Functions use, so local dev
// and production can't drift.
import { forward as forwardData } from './functions/api/data';
// These export onRequest directly rather than a forward() — they need
// the raw Request (for request.json(), redirects, or Set-Cookie),
// which doesn't fit the (method, query, body) shape the other two use.
import { onRequest as submitOnRequest } from './functions/api/submit';
import { onRequest as authLoginOnRequest } from './functions/api/auth/login';
import { onRequest as authLogoutOnRequest } from './functions/api/auth/logout';

/**
 * Cloudflare Pages Functions don't run under `vite dev`, so this plugin
 * mounts their handlers locally. Local and production stay in step.
 */
function apiDevServer(env: Record<string, string>): Plugin {
  // Both routes read the request the same way; only the handler and
  // the env slice differ. The Cookie header is passed straight through
  // (not parsed here) so forwardData can verify the session itself.
  const mount = (
    server: ViteDevServer,
    route: string,
    handler: (
      method: string,
      query: Record<string, string>,
      body: Record<string, unknown> | null,
      cookieHeader: string | null
    ) => Promise<{ status: number; body: unknown }>
  ) => {
    server.middlewares.use(route, async (req, res) => {
      const url = new URL(req.url || '', 'http://localhost');
      const query = Object.fromEntries(url.searchParams.entries());

      let body: Record<string, unknown> | null = null;

      if (req.method === 'POST') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        try {
          body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        } catch {
          body = {};
        }
      }

      const { status, body: payload } = await handler(
        req.method || 'GET',
        query,
        body,
        req.headers.cookie || null
      );

      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(payload));
    });
  };

  // Functions that need the raw Request (redirects, Set-Cookie,
  // request.json()) rather than the (method, query, body) shape above.
  const mountRaw = (
    server: ViteDevServer,
    route: string,
    handler: (request: Request) => Promise<Response>
  ) => {
    server.middlewares.use(route, async (req, res) => {
      const chunks: Buffer[] = [];
      if (req.method === 'POST') {
        for await (const chunk of req) chunks.push(chunk as Buffer);
      }

      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') headers.set(key, value);
        else if (Array.isArray(value)) headers.set(key, value.join(', '));
      }

      // Preserve the browser-visible host and port for same-origin
      // cookie behavior during local development.
      const host = req.headers.host || 'localhost:3000';
      const request = new Request(`http://${host}${req.url}`, {
        method: req.method,
        headers,
        body: chunks.length ? Buffer.concat(chunks) : undefined
      });

      const response = await handler(request);

      res.statusCode = response.status;
      // Headers.forEach folds multiple Set-Cookie values into one
      // comma-joined string — wrong for cookies — so use getSetCookie()
      // (Node 18.14+ / undici) to append each one separately instead.
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() !== 'set-cookie') res.setHeader(key, value);
      });
      const setCookies = response.headers.getSetCookie?.() ?? [];
      if (setCookies.length) res.setHeader('Set-Cookie', setCookies);

      res.end(Buffer.from(await response.arrayBuffer()));
    });
  };

  return {
    name: 'api-dev',
    configureServer(server) {
      const dataEnv = {
        SUPABASE_URL: env.SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
        GAS_URL: env.GAS_URL,
        GAS_TOKEN: env.GAS_TOKEN,
        DEMO_MODE: env.DEMO_MODE,
        SESSION_SECRET: env.SESSION_SECRET
      };

      const authEnv = {
        ...dataEnv,
        DEMO_EMAIL: env.DEMO_EMAIL,
        DEMO_PASSWORD: env.DEMO_PASSWORD,
        DEMO_MODE: env.DEMO_MODE,
        SESSION_SECRET: env.SESSION_SECRET
      };

      mount(server, '/api/data', (method, query, body, cookieHeader) =>
        forwardData(method, query, body, cookieHeader, dataEnv)
      );

      mountRaw(server, '/api/submit', (request) => submitOnRequest({ request, env: dataEnv }));
      mountRaw(server, '/api/auth/login', (request) => authLoginOnRequest({ request, env: authEnv }));
      mountRaw(server, '/api/auth/logout', (request) => authLogoutOnRequest({ request }));
    }
  };
}

export default defineConfig(({ mode }) => {
  // Empty prefix so server-only variables are readable here without a
  // VITE_ prefix — they must never reach the client. Resolved against
  // this file's directory, not cwd, so launching from a parent folder
  // still finds .env.local.
  const env = loadEnv(mode, __dirname, '');

  return {
    plugins: [react(), tailwindcss(), apiDevServer(env)],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.')
      }
    },
    server: {
      port: 3000
    }
  };
});
