// The Baton benchmark, part 1: ten single-lane tasks on the demo sites. Each check reads the
// demo site's own state or compares the lane's answer with the seed data, never the lane's word.

import { EVENT, INVOICES } from '../demo-sites/src/data.js';
import type { ApprovalCategory } from '../packages/core/src/safety/approval.js';

export const SITES = { inbox: 'http://localhost:4400', ledgerly: 'http://localhost:4401', roam: 'http://localhost:4402' };

export interface CheckInput {
  result: string;
  data: unknown;
  json: (url: string) => Promise<unknown>;
}

export interface BenchTask {
  id: string;
  site: keyof typeof SITES;
  startUrl: string;
  goal: string;
  // Approvals the task grants up front, recorded in the receipt as pre-approved. Anything else is declined.
  preApprove?: ApprovalCategory[];
  // Rough time for a person doing it by hand, for the time-saved comparison.
  manualSeconds: number;
  check: (i: CheckInput) => Promise<{ ok: boolean; detail: string }>;
}

const has = (text: string, ...needles: Array<string | RegExp>) => {
  const t = text.toLowerCase().replace(/\s+/g, ' ');
  const missing = needles.filter((n) => (typeof n === 'string' ? !t.includes(n.toLowerCase()) : !n.test(text)));
  return { ok: missing.length === 0, detail: missing.length ? `answer is missing ${missing.map(String).join(', ')}` : 'answer correct' };
};
const answer = (i: CheckInput) => `${i.result} ${i.data === undefined ? '' : JSON.stringify(i.data)}`;
const money = (cents: number) => (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });

const invoice = INVOICES[1]!; // a fixed invoice email in the Inbox

interface Bill {
  vendor: string;
  reference: string;
  amountCents: number;
  due: string;
  category: string;
}
interface InboxState {
  events: Array<{ title: string; start: string; end: string }>;
  drafts: Array<{ to: string; subject: string; body: string; status: string }>;
}

export const TASKS: BenchTask[] = [
  {
    id: 'ledgerly-new-bill',
    site: 'ledgerly',
    startUrl: `${SITES.ledgerly}/`,
    goal: 'In Ledgerly, enter a new bill: vendor Kestrel Print Works, reference INV-2300, amount $1,234.56, due date November 20, 2026, category Printing. Save it.',
    preApprove: ['submit'],
    manualSeconds: 75,
    check: async (i) => {
      const bills = (await i.json(`${SITES.ledgerly}/api/bills`)) as Bill[];
      const b = bills.find((x) => x.vendor.toLowerCase() === 'kestrel print works');
      if (!b) return { ok: false, detail: 'no Kestrel Print Works bill in Ledgerly' };
      const wrong = [
        b.reference !== 'INV-2300' && `reference ${b.reference}`,
        b.amountCents !== 123456 && `amount ${b.amountCents}`,
        b.due !== '2026-11-20' && `due ${b.due}`,
        b.category !== 'Printing' && `category ${b.category}`,
        bills.length !== 4 && `${bills.length} bills (expected exactly one new)`,
      ].filter(Boolean);
      return wrong.length ? { ok: false, detail: `saved with ${wrong.join(', ')}` } : { ok: true, detail: 'bill saved with every field right' };
    },
  },
  {
    id: 'ledgerly-bill-amount',
    site: 'ledgerly',
    startUrl: `${SITES.ledgerly}/`,
    goal: 'In Ledgerly, what is the amount of bill BL-0419, and who is the vendor?',
    manualSeconds: 20,
    check: async (i) => has(answer(i), '386.50', 'Quarry Coffee'),
  },
  {
    id: 'ledgerly-search-due',
    site: 'ledgerly',
    startUrl: `${SITES.ledgerly}/`,
    goal: 'In Ledgerly, search the bills for Brightwire and tell me when that bill is due.',
    manualSeconds: 20,
    check: async (i) => has(answer(i), /nov(ember)?\.? 5|11-05|11\/5/i),
  },
  {
    id: 'inbox-invitation',
    site: 'inbox',
    startUrl: `${SITES.inbox}/`,
    goal: 'In Inbox, open the Atlas Summit invitation and tell me the venue name, its street address and the dates of the event.',
    manualSeconds: 35,
    check: async (i) => has(answer(i), EVENT.venue, 'Rua da Doca 14', /dec(ember)?\.? 2|12-02/i, /4/),
  },
  {
    id: 'inbox-invoice-amount',
    site: 'inbox',
    startUrl: `${SITES.inbox}/`,
    goal: `In Inbox, find the invoice email from ${invoice.vendor} and tell me the invoice number and the amount due.`,
    manualSeconds: 40,
    check: async (i) => has(answer(i), invoice.number, money(invoice.amountCents)),
  },
  {
    id: 'inbox-calendar-event',
    site: 'inbox',
    startUrl: `${SITES.inbox}/calendar`,
    goal: 'In the Inbox calendar, add an event called "Atlas Summit" from December 2 to December 4, 2026.',
    preApprove: ['submit'],
    manualSeconds: 45,
    check: async (i) => {
      const s = (await i.json(`${SITES.inbox}/api/state`)) as InboxState;
      const e = s.events.find((x) => /atlas summit/i.test(x.title));
      if (!e) return { ok: false, detail: 'no Atlas Summit event in the calendar' };
      return e.start === '2026-12-02' && e.end === '2026-12-04' ? { ok: true, detail: 'event saved Dec 2–4' } : { ok: false, detail: `event saved ${e.start} to ${e.end}` };
    },
  },
  {
    id: 'inbox-draft-reply',
    site: 'inbox',
    startUrl: `${SITES.inbox}/`,
    goal: 'In Inbox, reply to Inês Duarte’s Atlas Summit invitation saying that Ama accepts and will confirm travel soon. Save the reply as a draft. Do not send it.',
    preApprove: ['submit'], // saving a draft only; "Send" is not pre-approved and would be declined
    manualSeconds: 60,
    check: async (i) => {
      const s = (await i.json(`${SITES.inbox}/api/state`)) as InboxState;
      if (s.drafts.some((d) => d.status === 'sent')) return { ok: false, detail: 'a message was sent' };
      const d = s.drafts.find((x) => x.status === 'draft' && x.to === EVENT.organiser.email);
      if (!d) return { ok: false, detail: 'no draft to the organiser' };
      return /accept/i.test(d.body) ? { ok: true, detail: 'draft saved, nothing sent' } : { ok: false, detail: 'draft does not accept' };
    },
  },
  {
    id: 'roam-cheapest-nonstop',
    site: 'roam',
    startUrl: `${SITES.roam}/`,
    goal: 'On Roam, find the cheapest nonstop flight from Lagos (LOS) to Lisbon (LIS) on December 1, 2026. Tell me the airline, departure time and price.',
    manualSeconds: 60,
    check: async (i) => has(answer(i), 'Tagus', '07:40', '212'),
  },
  {
    id: 'roam-hotel-near-venue',
    site: 'roam',
    startUrl: `${SITES.roam}/`,
    goal: 'On Roam, find hotels near Doca Hall for December 1 to December 4, 2026, within a 10 minute walk of the venue and under $200 a night. Which one is cheapest, and what does it cost per night?',
    manualSeconds: 75,
    check: async (i) => has(answer(i), 'Ribeira Azul', '168'),
  },
  {
    id: 'roam-speakers-dec3',
    site: 'roam',
    startUrl: `${SITES.roam}/`,
    goal: 'On Roam, open the Atlas Summit event guide and list the speakers of every session on December 3.',
    manualSeconds: 40,
    check: async (i) => {
      const r = has(answer(i), 'Marta Sousa', 'Ama Owusu', 'Rui Almeida');
      if (r.ok && /Tomás|Leila|Inês Duarte/.test(answer(i))) return { ok: false, detail: 'answer includes speakers from other days' };
      return r;
    },
  },
];
