// Stage 7 gate: the Baseten key must not appear in anything Baton Live sends to a browser.
// Run it with the built app served: `npm run build -w @baton/live`, then `npx vite preview` in apps/live.
// Scans every built file, then asks a running Live server (default http://localhost:5181) for the
// page, its assets, the demo-page shell and the budget endpoint, and scans those responses too.
// The key itself is read from .env and never printed.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const key = (readFileSync('.env', 'utf8').match(/^BASETEN_API_KEY=(.*)$/m)?.[1] ?? '').trim();
if (key.length < 12) throw new Error('no BASETEN_API_KEY in .env to check for');
// Only the key's value is a secret. The variable name and Baseten's host are constants in the shared
// model client (an error message and its default address, never called from the browser); they are
// reported as notes so the result is complete.
const needles = { 'the key': key };
const notes = { 'the key name': 'BASETEN_API_KEY', 'the Baseten host': 'inference.baseten.co' };
const noted = new Set();
const base = process.argv[2] ?? 'http://localhost:5181';
let problems = 0;

function scan(where, text) {
  for (const [what, needle] of Object.entries(needles))
    if (text.includes(needle)) {
      problems++;
      console.log(`FOUND ${what} in ${where}`);
    }
  for (const [what, needle] of Object.entries(notes)) if (text.includes(needle)) noted.add(what);
}

const files = (dir) =>
  readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
const built = files('apps/live/dist');
for (const f of built) scan(f, readFileSync(f, 'latin1'));
console.log(`scanned ${built.length} built files`);

const urls = [
  '/',
  '/sites/inbox/',
  '/api/budget',
  ...built
    .filter((f) => !f.endsWith('index.html'))
    .map((f) => '/' + f.slice('apps/live/dist/'.length).split('\\').join('/')),
];
for (const u of urls) {
  const r = await fetch(base + u);
  scan(`response ${u} (${r.status})`, await r.text());
}
// A refused model call must not echo the key either.
const bad = await fetch(base + '/api/chat/completions', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{"model":"other"}',
});
scan(`response /api/chat/completions (${bad.status})`, await bad.text());
console.log(`fetched ${urls.length + 1} responses from ${base}`);
if (noted.size)
  console.log(
    `note: ${[...noted].join(' and ')} appear(s) in the page bundle as constants of the shared model client, not secrets`,
  );
console.log(
  problems
    ? `FAIL: the key appears ${problems} time(s)`
    : 'PASS: the Baseten key appears in none of the built files or responses',
);
process.exit(problems ? 1 : 0);
