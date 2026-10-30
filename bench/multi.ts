// The Baton benchmark, part 2: ten requests with several parts. Each is planned once by the
// conductor, then run two ways: one lane doing every part in order, and the conductor running the
// parts in parallel. Checks read the demo sites' own data or compare answers with the seed data.

import { HOTELS, INVOICES, SESSIONS, searchFlights } from '../demo-sites/src/data.js';
import type { ApprovalCategory } from '../packages/core/src/safety/approval.js';
import { SITES } from './tasks.js';

export interface MultiCheckInput {
  text: string; // every part's result and data, joined
  json: (url: string) => Promise<unknown>;
}

export interface MultiTask {
  id: string;
  request: string;
  preApprove?: Array<{ category: ApprovalCategory; host: string }>;
  check: (i: MultiCheckInput) => Promise<{ ok: boolean; detail: string }>;
}

const has = (text: string, ...needles: Array<string | RegExp>) => {
  const missing = needles.filter((n) => (typeof n === 'string' ? !text.toLowerCase().includes(n.toLowerCase()) : !n.test(text)));
  return { ok: missing.length === 0, detail: missing.length ? `missing ${missing.map(String).join(', ')}` : 'all parts correct' };
};
const money = (cents: number) => (cents / 100).toFixed(2).replace(/\.00$/, '');
const cheapest = (from: string, to: string, date: string) => Math.min(...searchFlights(from, to, date).map((f) => f.priceCents));
const amount = (cents: number) => new RegExp(`\\$?${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 }).replace(/[.$]/g, '\\$&')}|\\$?${(cents / 100).toFixed(2).replace('.', '\\.')}`);

const [inv1, inv2, inv3] = [INVOICES[4]!, INVOICES[9]!, INVOICES[15]!];
const inv4 = INVOICES[21]!;
const ledgerly = new URL(SITES.ledgerly).host;
const inbox = new URL(SITES.inbox).host;

interface Bill {
  vendor: string;
  reference: string;
  amountCents: number;
  due: string;
}
interface InboxState {
  events: Array<{ title: string; start: string; end: string }>;
  drafts: Array<{ to: string; body: string; status: string }>;
}

export const MULTI_TASKS: MultiTask[] = [
  {
    id: 'lisbon-trip-research',
    request:
      'Find me the cheapest nonstop flight from Lagos to Lisbon on December 1, 2026, the cheapest hotel within a 10 minute walk of Doca Hall for December 1 to 4, and the time and room of my session at Atlas Summit.',
    check: async (i) => has(i.text, '212', 'Ribeira Azul', '168', '14:00', 'Room B'),
  },
  {
    id: 'compare-three-cities',
    request: 'Compare the cheapest flights from Lagos on December 1, 2026 to Lisbon, to London and to Madrid. Give me the price of each.',
    check: async (i) => has(i.text, money(cheapest('LOS', 'LIS', '2026-12-01')), money(cheapest('LOS', 'LHR', '2026-12-01')), money(cheapest('LOS', 'MAD', '2026-12-01'))),
  },
  {
    id: 'three-invoice-amounts',
    request: `In my Inbox, find the invoices from ${inv1.vendor}, ${inv2.vendor} and ${inv3.vendor} and tell me the invoice number and amount due of each.`,
    check: async (i) => has(i.text, inv1.number, amount(inv1.amountCents), inv2.number, amount(inv2.amountCents), inv3.number, amount(inv3.amountCents)),
  },
  {
    id: 'enter-two-bills',
    request:
      'In Ledgerly, enter two new bills: Upland Print Works, reference INV-7001, $410.00, due November 18, 2026, category Printing; and Harrow Logistics, reference INV-7002, $95.50, due November 21, 2026, category Shipping.',
    preApprove: [{ category: 'submit', host: ledgerly }],
    check: async (i) => {
      const bills = (await i.json(`${SITES.ledgerly}/api/bills`)) as Bill[];
      const a = bills.find((b) => b.reference === 'INV-7001');
      const b = bills.find((x) => x.reference === 'INV-7002');
      const ok = a?.amountCents === 41000 && a.due === '2026-11-18' && b?.amountCents === 9550 && b.due === '2026-11-21' && bills.length === 5;
      return { ok, detail: ok ? 'both bills saved correctly' : `bills: ${JSON.stringify(bills.slice(3).map((x) => [x.reference, x.amountCents, x.due]))}` };
    },
  },
  {
    id: 'calendar-and-draft',
    request: 'Add an event called "Board prep" on November 5, 2026 to my calendar, and save a draft email to kofi@harbourline.example saying I am in for Friday lunch. Do not send it.',
    preApprove: [{ category: 'submit', host: inbox }],
    check: async (i) => {
      const s = (await i.json(`${SITES.inbox}/api/state`)) as InboxState;
      const ev = s.events.find((e) => /board prep/i.test(e.title) && e.start === '2026-11-05');
      const dr = s.drafts.find((d) => d.to === 'kofi@harbourline.example' && d.status === 'draft');
      const sent = s.drafts.some((d) => d.status === 'sent');
      return { ok: !!ev && !!dr && !sent, detail: `event ${ev ? 'saved' : 'missing'}, draft ${dr ? 'saved' : 'missing'}${sent ? ', something was SENT' : ''}` };
    },
  },
  {
    id: 'bill-statuses',
    request: 'In Ledgerly, tell me the vendor, amount and status of bills BL-0418, BL-0419 and BL-0420.',
    check: async (i) => has(i.text, 'Northgate', /1,?240/, 'Paid', 'Quarry', '386.50', 'Brightwire', '129'),
  },
  {
    id: 'flights-two-dates',
    request: 'What is the cheapest flight from Lagos to Lisbon on December 1, 2026, and the cheapest flight back from Lisbon to Lagos on December 5, 2026?',
    check: async (i) => has(i.text, money(cheapest('LOS', 'LIS', '2026-12-01')), money(cheapest('LIS', 'LOS', '2026-12-05'))),
  },
  {
    id: 'speakers-and-hotel',
    request: 'Who speaks at Atlas Summit on December 2, and what does Casa Doca cost per night near the venue?',
    check: async (i) => has(i.text, ...SESSIONS.filter((s) => s.time.startsWith('Dec 2')).map((s) => s.speaker), String(HOTELS.find((h) => h.id === 'casa-doca')!.nightlyCents / 100)),
  },
  {
    id: 'invoice-to-bill',
    request: `Find the invoice from ${inv4.vendor} in my Inbox and enter it as a new bill in Ledgerly with its vendor, invoice number as reference, amount, due date and category.`,
    preApprove: [{ category: 'submit', host: ledgerly }],
    check: async (i) => {
      const bills = (await i.json(`${SITES.ledgerly}/api/bills`)) as Bill[];
      const b = bills.find((x) => x.reference === inv4.number);
      const ok = !!b && b.amountCents === inv4.amountCents && b.due === inv4.due;
      return { ok, detail: ok ? 'bill entered from the invoice' : `bill: ${JSON.stringify(b ?? null)}` };
    },
  },
  {
    id: 'venue-hotel-flight',
    request:
      'Get the Atlas Summit venue street address from the event page, the cheapest hotel under $150 a night within a 15 minute walk of it for December 1 to 4, and the cheapest flight from Accra to Lisbon on December 1, 2026.',
    check: async (i) => has(i.text, 'Rua da Doca 14', 'Pátio Verde', '139', money(cheapest('ACC', 'LIS', '2026-12-01'))),
  },
];
