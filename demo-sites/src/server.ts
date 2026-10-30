// Serves every demo site from one command: `npm run demo-sites`.
// Inbox :4400 · Ledgerly :4401 · Roam :4402 · Hostile page :4403. State lives in memory;
// POST /__reset on any site restores the starting state for all of them.

import { createServer } from 'node:http';
import { freshState, type State } from './data.js';
import { hostile } from './hostile.js';
import { inbox } from './inbox.js';
import { ledgerly } from './ledgerly.js';
import { roam } from './roam.js';
import { handler } from './router.js';

export const PORTS = { inbox: 4400, ledgerly: 4401, roam: 4402, hostile: 4403 } as const;

let state: State = freshState();
const get = () => state;
const reset = () => {
  state = freshState();
  console.log('[demo-sites] state reset');
};

const sites = [inbox(get, PORTS.inbox), ledgerly(get, PORTS.ledgerly), roam(get, PORTS.roam), hostile(PORTS.hostile)];

for (const site of sites) {
  createServer(handler(site, reset))
    .on('error', (e) => {
      console.error(`[demo-sites] ${site.name} could not start on ${site.port}: ${e.message}`);
      process.exit(1);
    })
    .listen(site.port, '127.0.0.1', () =>
      console.log(`[demo-sites] ${site.name.padEnd(11)} http://localhost:${site.port}`),
    );
}
