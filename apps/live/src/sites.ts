// Baton Live's demo sites, rendered inside the visitor's own page. The same site code as
// `npm run demo-sites` runs here, under /sites/<name>/, so every visitor has their own Inbox,
// Ledgerly and Roam: nothing one visitor does reaches another, and the server keeps no state.
//
// Every /sites/… address is served as the same tiny shell page (public/shell.html), which asks this
// page for its HTML. Links are real navigations; form posts are handed over by the frame script.
// So every page a lane sees has a real URL and every step is a real page load, as on the desktop.

import { freshState, type State } from '../../../demo-sites/src/data';
import { hostile } from '../../../demo-sites/src/hostile';
import { inbox } from '../../../demo-sites/src/inbox';
import { ledgerly } from '../../../demo-sites/src/ledgerly';
import { roam } from '../../../demo-sites/src/roam';
import { dispatch, type Site } from '../../../demo-sites/src/router';

const STORE = 'baton-live-sites';

function load(): State {
  try {
    const saved = localStorage.getItem(STORE);
    if (saved) return JSON.parse(saved) as State;
  } catch {
    /* private mode or blocked storage: start fresh */
  }
  return freshState();
}

let state = load();
const get = () => state;
const save = () => {
  try {
    localStorage.setItem(STORE, JSON.stringify(state));
  } catch {
    /* the sites still work for this visit */
  }
};

// The ports are only labels here; pages are reached by path.
const SITES: Record<string, Site> = {
  inbox: inbox(get, 4400),
  ledgerly: ledgerly(get, 4401),
  roam: roam(get, 4402),
  hostile: hostile(4403),
};

// The sites link with root paths ("/m/3"); under /sites/inbox/ those become "/sites/inbox/m/3".
export function rebase(html: string, base: string): string {
  return html.replace(/(\s(?:href|action|src)=")\/(?!\/)/g, `$1${base}/`);
}

export type SiteReply = { html: string } | { redirect: string };

function route(method: 'GET' | 'POST', href: string, body: URLSearchParams): SiteReply {
  const url = new URL(href);
  const m = url.pathname.match(/^\/sites\/([a-z]+)(\/.*)?$/);
  const site = m ? SITES[m[1]!] : undefined;
  if (!m || !site) return { html: '<h1>Not found</h1><p>There is no demo site at this address.</p>' };
  const base = `/sites/${m[1]}`;
  const inner = new URL(url.href);
  inner.pathname = m[2] || '/';
  const out = dispatch(site, method, inner, body);
  if (method === 'POST') save();
  const location = out.headers.location;
  if (out.status === 303 && location)
    return { redirect: location.startsWith('/') ? `${url.origin}${base}${location}` : location };
  const html = (out.headers['content-type'] ?? '').startsWith('text/html')
    ? out.body
    : `<pre>${out.body.replace(/</g, '&lt;')}</pre>`;
  return { html: rebase(html, base).replace('</body>', '<script src="/frame.js"></script></body>') };
}

export const sites = {
  page: (href: string) => route('GET', href, new URLSearchParams()),
  post: (href: string, body: string) => route('POST', href, new URLSearchParams(body)),
  reset() {
    state = freshState();
    save();
  },
};

(window as unknown as { __batonSites: typeof sites }).__batonSites = sites;
