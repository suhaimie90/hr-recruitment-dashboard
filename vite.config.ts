import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';
// Same implementation the deployed Pages Functions use, so local dev
// and production can't drift.
import { forward } from './functions/api/gas';
import { forward as forwardData } from './functions/api/data';
// submit.ts exports onRequest directly rather than a forward() — it
// needs the raw Request (for request.json()), which doesn't fit the
// (method, query, body) shape the other two functions use.
import { onRequest as submitOnRequest } from './functions/api/submit';

/**
 * Vercel serverless functions don't run under `vite dev`, so this
 * plugin serves /api/gas locally using the exact same forwarding code
 * the deployed function uses. Local and production stay in step.
 */
function apiDevServer(env: Record<string, string>): Plugin {
  // Both routes read the request the same way; only the handler and
  // the env slice differ.
  const mount = (
    server: ViteDevServer,
    route: string,
    handler: (
      method: string,
      query: Record<string, string>,
      body: Record<string, unknown> | null
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

      const { status, body: payload } = await handler(req.method || 'GET', query, body);

      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(payload));
    });
  };

  return {
    name: 'api-dev',
    configureServer(server) {
      // Legacy Apps Script proxy — kept until the Supabase cutover is
      // proven, so rolling back is a one-line change in api.ts.
      mount(server, '/api/gas', (method, query, body) =>
        forward(method, query, body, { GAS_URL: env.GAS_URL, GAS_TOKEN: env.GAS_TOKEN })
      );

      mount(server, '/api/data', (method, query, body) =>
        forwardData(method, query, body, {
          SUPABASE_URL: env.SUPABASE_URL,
          SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY
        })
      );

      server.middlewares.use('/api/submit', async (req, res) => {
        const chunks: Buffer[] = [];
        if (req.method === 'POST') {
          for await (const chunk of req) chunks.push(chunk as Buffer);
        }

        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
          if (typeof value === 'string') headers.set(key, value);
          else if (Array.isArray(value)) headers.set(key, value.join(', '));
        }

        const request = new Request(`http://localhost${req.url}`, {
          method: req.method,
          headers,
          body: chunks.length ? Buffer.concat(chunks) : undefined
        });

        const response = await submitOnRequest({
          request,
          env: {
            SUPABASE_URL: env.SUPABASE_URL,
            SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY
          }
        });

        res.statusCode = response.status;
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.end(Buffer.from(await response.arrayBuffer()));
      });
    }
  };
}

export default defineConfig(({ mode }) => {
  // Empty prefix so GAS_URL / GAS_TOKEN are readable here without a
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
