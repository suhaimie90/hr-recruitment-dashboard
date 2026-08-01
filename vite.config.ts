import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { forward } from './api/_forward';

/**
 * Vercel serverless functions don't run under `vite dev`, so this
 * plugin serves /api/gas locally using the exact same forwarding code
 * the deployed function uses. Local and production stay in step.
 */
function apiDevServer(env: Record<string, string>): Plugin {
  return {
    name: 'gas-api-dev',
    configureServer(server) {
      server.middlewares.use('/api/gas', async (req, res) => {
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

        const { status, body: payload } = await forward(req.method || 'GET', query, body, {
          GAS_URL: env.GAS_URL,
          GAS_TOKEN: env.GAS_TOKEN
        });

        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(payload));
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
