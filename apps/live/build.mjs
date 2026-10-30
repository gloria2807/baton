// Builds Baton Live: the demo-page shell and the frame script (the hands inside each demo page)
// into public/, then the page with Vite. `--dev` serves it with the model
// proxy on http://localhost:5180 instead.
import { build, context } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { iconPng } from '../../scripts/icon.mjs';

const dev = process.argv.includes('--dev');
mkdirSync('public', { recursive: true });
writeFileSync('public/icon.png', iconPng(64));
// Every /sites/... address serves this shell; it asks the Live page (src/sites.ts) for its HTML.
writeFileSync(
  'public/shell.html',
  `<!doctype html><meta charset="utf-8"><script>
var s = window.parent !== window && window.parent.__batonSites;
var r = s ? s.page(location.href) : { html: '<p style="font:15px system-ui;padding:24px">This demo page belongs to Baton Live. <a href="/" target="_top">Open Baton Live</a>.</p>' };
if (r.redirect) location.replace(r.redirect); else { document.open(); document.write(r.html); document.close(); }
</script>`,
);

const common = {
  bundle: true,
  format: 'iife',
  target: 'es2022',
  logLevel: 'warning',
  sourcemap: dev ? 'inline' : false,
  minify: !dev,
};
const configs = [{ ...common, entryPoints: ['src/frame.ts'], outfile: 'public/frame.js' }];

if (dev) {
  for (const c of configs) await (await context(c)).watch();
  const { createServer } = await import('vite');
  const server = await createServer({ configFile: 'vite.config.ts', server: { port: 5180, strictPort: true } });
  await server.listen();
  server.printUrls();
} else {
  await Promise.all(configs.map((c) => build(c)));
  const { build: viteBuild } = await import('vite');
  await viteBuild({ configFile: 'vite.config.ts' });
  console.log('live built');
}
