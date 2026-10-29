// Tiny HTML helpers shared by the demo sites. Server-rendered pages keep every navigation a real
// page load, which makes a lane's "did the page change?" check honest.

export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Tagged template that escapes interpolations unless they are already marked safe with raw().
export class Raw {
  constructor(readonly html: string) {}
  toString(): string {
    return this.html;
  }
}

export const raw = (html: string): Raw => new Raw(html);

export function html(strings: TemplateStringsArray, ...values: unknown[]): Raw {
  let out = strings[0] ?? '';
  values.forEach((v, i) => {
    out += render(v) + (strings[i + 1] ?? '');
  });
  return new Raw(out);
}

function render(v: unknown): string {
  if (v instanceof Raw) return v.html;
  if (Array.isArray(v)) return v.map(render).join('');
  if (v === false || v === null || v === undefined) return '';
  return esc(v);
}

export const money = (cents: number): string =>
  '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const BASE_CSS = `
*{box-sizing:border-box}
html,body{margin:0}
body{font:15px/1.5 "Inter","Segoe UI",system-ui,-apple-system,sans-serif;color:#0f172a;background:var(--bg);min-height:100vh;display:flex;flex-direction:column}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
main{flex:1;width:100%;max-width:1200px;margin:0 auto;padding:28px 48px}
h1{font-size:30px;margin:8px 0 18px}
h2{font-size:20px;margin:24px 0 12px}
label{display:block;font-weight:600;font-size:13px;color:#334155;margin:14px 0 6px}
input,select,textarea{font:inherit;width:100%;padding:10px 14px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#0f172a}
textarea{min-height:140px;resize:vertical}
input:focus,select:focus,textarea:focus{outline:2px solid var(--accent);outline-offset:1px}
.btn{display:inline-block;font:inherit;font-weight:600;padding:10px 20px;border-radius:8px;border:1px solid transparent;background:var(--accent);color:#fff;cursor:pointer}
.btn:hover{text-decoration:none;filter:brightness(1.08)}
.btn.secondary{background:#fff;color:#0f172a;border-color:#cbd5e1}
.row{display:flex;gap:16px;align-items:center}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 20px}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px 24px}
.muted{color:#64748b}
.notice{background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;padding:10px 16px;border-radius:8px;margin-bottom:16px}
table{border-collapse:collapse;width:100%}
th{text-align:left;font-size:13px;color:#64748b;font-weight:600;padding:10px 12px}
td{padding:12px;border-top:1px solid #e2e8f0;background:#fff}
footer{padding:18px 48px;font-size:13px;color:#94a3b8}
`;

export function page(opts: { title: string; site: string; css: string; nav?: Raw; body: Raw }): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)} · ${esc(opts.site)}</title>
<style>${BASE_CSS}${opts.css}</style></head>
<body>${opts.nav?.html ?? ''}<main>${opts.body.html}</main>
<footer>${esc(opts.site)} is a fictional demo site · Baton test data</footer></body></html>`;
}
