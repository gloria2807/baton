// Inbox: a small fictional webmail with mail, drafts and a calendar.

import { EVENT, PERSON, type Email, type State } from './data.js';
import { html, page, type Raw } from './html.js';
import type { Site } from './router.js';

const CSS = `
:root{--bg:#f4f6f8;--accent:#0f766e}
.top{display:flex;align-items:center;gap:28px;background:#0b3b38;color:#e6fffb;padding:0 32px;height:60px}
.top .brand{font-weight:800;font-size:22px;color:#fff;margin-right:12px}
.top a{color:#b6f0e8;font-weight:500}
.top a.on{color:#fff;text-decoration:underline;text-underline-offset:6px}
.top form{margin-left:auto;width:320px}
.top input{background:#134e4a;border-color:#1f6f69;color:#fff}
.top input::placeholder{color:#8cc9c1}
.mail{display:block;background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden}
.mail a.item{display:grid;grid-template-columns:220px 1fr 110px;gap:18px;padding:12px 18px;border-top:1px solid #eef2f6;color:#0f172a}
.mail a.item:first-child{border-top:0}
.mail a.item:hover{background:#f0fdfa;text-decoration:none}
.mail .unread{font-weight:700}
.mail .subj span{color:#64748b;font-weight:400}
.mail .date{text-align:right;color:#64748b;font-size:13px}
.msg .meta{color:#475569;margin-bottom:18px}
.msg .body{white-space:pre-wrap;font-size:16px;line-height:1.65}
.actions{display:flex;gap:12px;margin:20px 0}
.cal{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:#e2e8f0;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden}
.cal .dow{background:#f8fafc;font-size:12px;color:#64748b;padding:8px;font-weight:600}
.cal .day{background:#fff;min-height:96px;padding:6px 8px;font-size:13px}
.cal .day.other{background:#f8fafc;color:#cbd5e1}
.cal .ev{display:block;margin-top:4px;background:#ccfbf1;color:#115e59;border-radius:5px;padding:2px 6px;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
`;

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const fmtLong = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

function nav(on: string, q = ''): Raw {
  const link = (href: string, label: string, key: string) => html`<a href="${href}" class="${on === key ? 'on' : ''}">${label}</a>`;
  return html`<header class="top"><span class="brand">Inbox</span>${link('/', 'Mail', 'mail')}${link('/drafts', 'Drafts', 'drafts')}${link('/sent', 'Sent', 'sent')}${link('/calendar', 'Calendar', 'calendar')}
  <form action="/" method="get"><input name="q" type="search" placeholder="Search mail" value="${q}" aria-label="Search mail"></form></header>`;
}

const view = (title: string, on: string, body: Raw, q = '') => ({ html: page({ title, site: 'Inbox', css: CSS, nav: nav(on, q), body }) });

function mailList(emails: Email[]): Raw {
  if (!emails.length) return html`<p class="muted">No messages.</p>`;
  return html`<div class="mail" role="list">${emails.map(
    (e) => html`<a class="item ${e.unread ? 'unread' : ''}" role="listitem" href="/m/${e.id}"><span>${e.from.name}</span><span class="subj">${e.subject} <span>— ${e.preview}</span></span><span class="date">${fmtDate(e.date)}</span></a>`,
  )}</div>`;
}

function calendar(state: State, month: string): Raw {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const start = new Date(first);
  start.setUTCDate(1 - ((first.getUTCDay() + 6) % 7)); // weeks start Monday
  const cells: Raw[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const evs = state.events.filter((e) => e.start <= iso && iso <= e.end);
    cells.push(html`<div class="day ${d.getUTCMonth() !== m - 1 ? 'other' : ''}" data-date="${iso}">${d.getUTCDate()}${evs.map((e) => html`<span class="ev" title="${e.title}">${e.title}</span>`)}</div>`);
  }
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  const label = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return html`<div class="row" style="justify-content:space-between"><h1>${label}</h1><div class="row"><a class="btn secondary" href="/calendar?month=${prev}">‹ Previous</a><a class="btn secondary" href="/calendar?month=${next}">Next ›</a><a class="btn" href="/calendar/new">+ New event</a></div></div>
  <div class="cal">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => html`<div class="dow">${d}</div>`)}${cells}</div>`;
}

export function inbox(state: () => State, port: number): Site {
  return {
    name: 'Inbox',
    port,
    routes: [
      ['GET', /^\/$/, (req) => {
        const q = (req.query.get('q') ?? '').trim().toLowerCase();
        const list = state().emails.filter((e) => !q || `${e.from.name} ${e.subject} ${e.body}`.toLowerCase().includes(q));
        const unread = state().emails.filter((e) => e.unread).length;
        return view('Mail', 'mail', html`<h1>${q ? `Search: ${q}` : 'Mail'} <span class="muted" style="font-size:16px;font-weight:500">${q ? `${list.length} results` : `${unread} unread`}</span></h1>${mailList(list)}`, q);
      }],
      ['GET', /^\/m\/([\w-]+)$/, (req) => {
        const e = state().emails.find((x) => x.id === req.params[0]);
        if (!e) return { html: 'Message not found', status: 404 };
        e.unread = false;
        return view(e.subject, 'mail', html`<article class="msg card"><h1>${e.subject}</h1>
          <div class="meta"><strong>${e.from.name}</strong> &lt;${e.from.email}&gt; · to ${e.to} · ${fmtLong(e.date)}</div>
          <div class="body">${e.body}</div>
          <div class="actions"><a class="btn" href="/compose?reply=${e.id}">Reply</a><a class="btn secondary" href="/compose?forward=${e.id}">Forward</a><a class="btn secondary" href="/">Back to mail</a></div></article>`);
      }],
      ['GET', /^\/compose$/, (req) => {
        const draftId = req.query.get('draft');
        const d = draftId ? state().drafts.find((x) => x.id === draftId) : undefined;
        const src = state().emails.find((x) => x.id === (req.query.get('reply') ?? req.query.get('forward')));
        const isReply = !!req.query.get('reply');
        const to = d?.to ?? (isReply && src ? src.from.email : '');
        const subject = d?.subject ?? (src ? `${isReply ? 'Re' : 'Fwd'}: ${src.subject}` : '');
        const quoted = src ? `\n\n— On ${fmtDate(src.date)}, ${src.from.name} wrote —\n${src.body}` : '';
        return view('Compose', 'mail', html`<h1>${isReply ? 'Reply' : 'New message'}</h1>
          <form class="card" method="post" action="/compose">
          <input type="hidden" name="id" value="${d?.id ?? ''}"><input type="hidden" name="inReplyTo" value="${d?.inReplyTo ?? (isReply ? src?.id : '') ?? ''}">
          <label for="to">To</label><input id="to" name="to" type="email" value="${to}">
          <label for="subject">Subject</label><input id="subject" name="subject" value="${subject}">
          <label for="body">Message</label><textarea id="body" name="body" rows="12">${d?.body ?? quoted}</textarea>
          <div class="actions"><button class="btn" name="action" value="send">Send</button><button class="btn secondary" name="action" value="save">Save draft</button></div></form>`);
      }],
      ['POST', /^\/compose$/, (req) => {
        const s = state();
        const id = req.body.get('id') || `d-${s.drafts.length + 1}`;
        const existing = s.drafts.find((x) => x.id === id);
        const draft = {
          id,
          to: req.body.get('to') ?? '',
          subject: req.body.get('subject') ?? '',
          body: req.body.get('body') ?? '',
          inReplyTo: req.body.get('inReplyTo') || undefined,
          status: req.body.get('action') === 'send' ? ('sent' as const) : ('draft' as const),
          updated: new Date().toISOString(),
        };
        if (existing) Object.assign(existing, draft);
        else s.drafts.push(draft);
        return { redirect: draft.status === 'sent' ? '/sent?ok=1' : '/drafts?ok=1' };
      }],
      ['GET', /^\/(drafts|sent)$/, (req) => {
        const which = req.params[0] as 'drafts' | 'sent';
        const list = state().drafts.filter((d) => d.status === (which === 'sent' ? 'sent' : 'draft'));
        const ok = req.query.get('ok') ? html`<div class="notice">${which === 'sent' ? 'Message sent.' : 'Draft saved.'}</div>` : '';
        return view(which === 'sent' ? 'Sent' : 'Drafts', which, html`<h1>${which === 'sent' ? 'Sent' : 'Drafts'}</h1>${ok}
          ${list.length ? html`<div class="mail">${list.map((d) => html`<a class="item" href="${which === 'drafts' ? `/compose?draft=${d.id}` : '#'}"><span>To: ${d.to || '(no recipient)'}</span><span class="subj">${d.subject || '(no subject)'} <span>— ${d.body.slice(0, 80)}</span></span><span class="date">${fmtDate(d.updated)}</span></a>`)}</div>` : html`<p class="muted">Nothing here yet.</p>`}`);
      }],
      ['GET', /^\/calendar$/, (req) => {
        const month = /^\d{4}-\d{2}$/.test(req.query.get('month') ?? '') ? req.query.get('month')! : '2026-11';
        const ok = req.query.get('ok') ? html`<div class="notice">Event added.</div>` : '';
        return view('Calendar', 'calendar', html`${ok}${calendar(state(), month)}`);
      }],
      ['GET', /^\/calendar\/new$/, () =>
        view('New event', 'calendar', html`<h1>New event</h1><form class="card" method="post" action="/calendar/new" style="max-width:640px">
          <label for="title">Title</label><input id="title" name="title" required>
          <div class="grid2"><div><label for="start">Start date</label><input id="start" name="start" type="date" required></div>
          <div><label for="end">End date</label><input id="end" name="end" type="date" required></div></div>
          <label for="note">Notes</label><input id="note" name="note">
          <div class="actions"><button class="btn">Save event</button><a class="btn secondary" href="/calendar">Cancel</a></div></form>`)],
      ['POST', /^\/calendar\/new$/, (req) => {
        const s = state();
        const start = req.body.get('start') ?? '';
        const end = req.body.get('end') || start;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return { html: 'Start date is required', status: 400 };
        s.events.push({ id: `ev-${s.events.length + 1}`, title: req.body.get('title') || 'Untitled', start, end: end < start ? start : end, note: req.body.get('note') ?? '' });
        return { redirect: `/calendar?month=${start.slice(0, 7)}&ok=1` };
      }],
      // Read-only JSON for gate checks and the benchmark.
      ['GET', /^\/api\/state$/, () => ({ json: { events: state().events, drafts: state().drafts, person: PERSON, event: EVENT } })],
    ],
  };
}
