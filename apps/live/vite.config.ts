import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite';
import { envFromProcess, handleBudget, handleProxy, type ProxyEnv } from './server/proxy';

// The same proxy as the deployed /api functions, for `npm run dev` and `vite preview`. The key is
// read from the repository's .env here, in Node; it is never part of the page's bundle.
function liveProxy(): Plugin {
  let env: ProxyEnv | null = null;
  const middleware: Connect.NextHandleFunction = (req: IncomingMessage, res: ServerResponse, next) => {
    const path = (req.url ?? '').split('?')[0] ?? '';
    // Every demo-site address is the shell page, as the deployed rewrite does (vercel.json).
    if (path.startsWith('/sites/')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(readFileSync(resolve(__dirname, 'public/shell.html')));
      return;
    }
    if (path !== '/api/chat/completions' && path !== '/api/budget') return next();
    env ??= envFromProcess({ ...process.env, ...loadEnv('development', resolve(__dirname, '../..'), '') });
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
      const request = new Request(`http://localhost${req.url}`, {
        method: req.method,
        headers,
        body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
      });
      const handle = path === '/api/budget' ? handleBudget : handleProxy;
      void handle(request, env!).then(async (r) => {
        res.writeHead(r.status, Object.fromEntries(r.headers));
        res.end(Buffer.from(await r.arrayBuffer()));
      }, next);
    });
  };
  return {
    name: 'baton-live-proxy',
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
  };
}

export default defineConfig({
  plugins: [react(), liveProxy()],
  preview: { port: 5181, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
});
