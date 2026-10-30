import type { IncomingMessage, ServerResponse } from 'node:http';

export interface Req {
  method: string;
  path: string;
  query: URLSearchParams;
  body: URLSearchParams;
  params: string[];
}

export type Res = { html: string; status?: number } | { json: unknown; status?: number } | { redirect: string };

export type Handler = (req: Req) => Res;
export type Route = [method: 'GET' | 'POST', pattern: RegExp, handler: Handler];

export interface Site {
  name: string;
  port: number;
  routes: Route[];
}

async function readBody(req: IncomingMessage): Promise<URLSearchParams> {
  if (req.method !== 'POST') return new URLSearchParams();
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  if ((req.headers['content-type'] ?? '').includes('application/json')) {
    const obj = text ? (JSON.parse(text) as Record<string, string>) : {};
    return new URLSearchParams(Object.entries(obj).map(([k, v]) => [k, String(v)]));
  }
  return new URLSearchParams(text);
}

export interface Reply {
  status: number;
  headers: Record<string, string>;
  body: string;
}

// One request through a site's routes. Shared by the Node server and Baton Live's service worker.
export function dispatch(site: Site, method: string, url: URL, body: URLSearchParams): Reply {
  for (const [m, pattern, h] of site.routes) {
    if (m !== method) continue;
    const match = url.pathname.match(pattern);
    if (!match) continue;
    try {
      const out = h({
        method,
        path: url.pathname,
        query: url.searchParams,
        body,
        params: match.slice(1).map(decodeURIComponent),
      });
      if ('redirect' in out) return { status: 303, headers: { location: out.redirect }, body: '' };
      if ('json' in out)
        return {
          status: out.status ?? 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(out.json),
        };
      return { status: out.status ?? 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: out.html };
    } catch (e) {
      return {
        status: 500,
        headers: { 'content-type': 'text/plain' },
        body: `Demo site error: ${(e as Error).message}`,
      };
    }
  }
  return {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: `<h1>Not found</h1><p>${site.name} has no page at ${url.pathname.replace(/</g, '&lt;')}</p>`,
  };
}

export function handler(site: Site, onReset: () => void) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://localhost:${site.port}`);
    const method = req.method ?? 'GET';
    // Shared reset endpoint used by `npm run demo:reset` and the benchmark.
    if (method === 'POST' && url.pathname === '/__reset') {
      onReset();
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
      return;
    }
    const out = dispatch(site, method, url, await readBody(req));
    res.writeHead(out.status, out.headers).end(out.body);
  };
}
