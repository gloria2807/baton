// Fictional seed data for the demo sites. Everything is deterministic so `reset()` always
// returns the same starting state the film and the benchmark rely on.

export const TODAY = '2026-10-29';

export const PERSON = { name: 'Ama Owusu', email: 'ama@harbourline.example', company: 'Harbourline' };

export const EVENT = {
  name: 'Atlas Summit 2026',
  city: 'Lisbon',
  venue: 'Doca Hall',
  address: 'Rua da Doca 14, 1200-109 Lisbon, Portugal',
  start: '2026-12-02',
  end: '2026-12-04',
  organiser: { name: 'Inês Duarte', email: 'ines@atlas-summit.example' },
};

// Small seeded PRNG (mulberry32) so generated amounts never change between runs.
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Email {
  id: string;
  from: { name: string; email: string };
  to: string;
  subject: string;
  date: string; // ISO date-time
  preview: string;
  body: string; // plain text, paragraphs separated by blank lines
  kind: 'invitation' | 'invoice' | 'other';
  invoice?: Invoice;
  unread: boolean;
}

export interface Invoice {
  vendor: string;
  number: string;
  amountCents: number;
  due: string; // ISO date
  category: string;
  description: string;
}

const VENDOR_STEMS = [
  'Kestrel',
  'Bluefin',
  'Copperleaf',
  'Ironbark',
  'Saltmarsh',
  'Juniper',
  'Larkspur',
  'Meridian',
  'Oakhurst',
  'Pinecrest',
  'Redfern',
  'Silverline',
  'Thornbury',
  'Upland',
  'Westbrook',
  'Harrow',
  'Fennel',
  'Granite Bay',
  'Hollis',
  'Marlow',
];
const VENDOR_KINDS: Array<[string, string, string]> = [
  ['Print Works', 'Printing', 'Event brochures and badges'],
  ['Logistics', 'Shipping', 'Courier deliveries for October'],
  ['Office Furniture', 'Office', 'Two standing desks and chairs'],
  ['Cleaning Services', 'Facilities', 'Office cleaning, October'],
  ['Water Co', 'Facilities', 'Water cooler refills'],
  ['Cloud Hosting', 'Software', 'Hosting plan, October'],
  ['Catering', 'Meals', 'Team lunch catering'],
  ['Stationery', 'Office', 'Paper, pens and folders'],
];

function buildInvoices(): Invoice[] {
  const r = rng(2026);
  const out: Invoice[] = [];
  for (let i = 0; i < 40; i++) {
    const stem = VENDOR_STEMS[i % VENDOR_STEMS.length]!;
    const [kind, category, description] = VENDOR_KINDS[(i * 3 + Math.floor(i / 20)) % VENDOR_KINDS.length]!;
    const day = 3 + Math.floor(r() * 26);
    out.push({
      vendor: `${stem} ${kind}`,
      number: `INV-${String(2300 + i * 7 + Math.floor(r() * 5)).padStart(4, '0')}`,
      amountCents: Math.round(((60 + r() * 2400) * 100) / 5) * 5,
      due: `2026-11-${String(day).padStart(2, '0')}`,
      category,
      description,
    });
  }
  return out;
}

export const INVOICES = buildInvoices();

function invoiceEmail(inv: Invoice, i: number): Email {
  const amount = '$' + (inv.amountCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
  const dueText = new Date(inv.due + 'T12:00:00Z').toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const slug = inv.vendor
    .toLowerCase()
    .replace(/[^a-z]+/g, '-')
    .replace(/-+$/, '');
  return {
    id: `inv-${i + 1}`,
    from: { name: `${inv.vendor} Billing`, email: `billing@${slug}.example` },
    to: PERSON.email,
    subject: `Invoice ${inv.number} from ${inv.vendor}`,
    date: `2026-10-${String(28 - Math.floor(i / 2)).padStart(2, '0')}T${String(8 + (i % 9)).padStart(2, '0')}:${String((i * 13) % 60).padStart(2, '0')}:00Z`,
    preview: `${inv.description}. Amount due ${amount}, due ${dueText}.`,
    body: [
      `Hi ${PERSON.name.split(' ')[0]},`,
      `Please find our invoice for ${inv.description.toLowerCase()}.`,
      `Invoice number: ${inv.number}\nVendor: ${inv.vendor}\nAmount due: ${amount}\nDue date: ${dueText}\nCategory: ${inv.category}`,
      `Thank you for your business.`,
      `${inv.vendor} Billing`,
    ].join('\n\n'),
    kind: 'invoice',
    invoice: inv,
    unread: i % 3 !== 0,
  };
}

function buildEmails(): Email[] {
  const invitation: Email = {
    id: 'atlas-invite',
    from: EVENT.organiser,
    to: PERSON.email,
    subject: `You're invited to speak at ${EVENT.name} in Lisbon`,
    date: '2026-10-29T09:12:00Z',
    preview: `Dear Ama, we would love you to join us at ${EVENT.venue}, December 2–4.`,
    body: [
      `Dear Ama,`,
      `We would love you to join us as a speaker at ${EVENT.name}, a three-day gathering for operations leaders, held from December 2 to December 4, 2026.`,
      `Venue: ${EVENT.venue}\n${EVENT.address}`,
      `Your session, "Running a small team on fewer tabs", is planned for December 3 at 14:00 in Room B. We cover your conference pass; travel and accommodation are booked by speakers.`,
      `Could you reply to confirm by November 10? We will send the speaker pack after that.`,
      `Warm regards,\n${EVENT.organiser.name}\nSpeaker programme, ${EVENT.name}`,
    ].join('\n\n'),
    kind: 'invitation',
    unread: true,
  };
  const others: Email[] = [
    {
      id: 'team-lunch',
      from: { name: 'Kofi Asante', email: 'kofi@harbourline.example' },
      to: PERSON.email,
      subject: 'Team lunch on Friday?',
      date: '2026-10-29T08:40:00Z',
      preview: 'Thinking of the noodle place on Marina Road at 12:30. In?',
      body: 'Hi Ama,\n\nThinking of the noodle place on Marina Road at 12:30 on Friday. Are you in?\n\nKofi',
      kind: 'other',
      unread: true,
    },
    {
      id: 'q4-planning',
      from: { name: 'Zainab Bello', email: 'zainab@harbourline.example' },
      to: PERSON.email,
      subject: 'Q4 planning doc, comments by Monday',
      date: '2026-10-27T15:05:00Z',
      preview: 'I have shared the Q4 planning doc. Please add comments by Monday.',
      body: 'Hi all,\n\nI have shared the Q4 planning doc. Please add your comments by Monday so we can finalise headcount.\n\nZainab',
      kind: 'other',
      unread: false,
    },
    {
      id: 'newsletter',
      from: { name: 'The Ops Letter', email: 'news@opsletter.example' },
      to: PERSON.email,
      subject: 'This week: the case for fewer meetings',
      date: '2026-10-26T07:00:00Z',
      preview: 'Five teams who cut their meetings in half, and what happened next.',
      body: 'This week: five teams who cut their meetings in half, and what happened next.\n\nRead online at opsletter.example.',
      kind: 'other',
      unread: false,
    },
    {
      id: 'it-reminder',
      from: { name: 'Harbourline IT', email: 'it@harbourline.example' },
      to: PERSON.email,
      subject: 'Reminder: laptop updates this weekend',
      date: '2026-10-24T11:20:00Z',
      preview: 'Please leave your laptop on and plugged in on Saturday night.',
      body: 'Hi everyone,\n\nPlease leave your laptop on and plugged in on Saturday night so updates can install.\n\nThanks,\nIT',
      kind: 'other',
      unread: false,
    },
  ];
  const all = [invitation, ...others, ...INVOICES.map(invoiceEmail)];
  return all.sort((a, b) => b.date.localeCompare(a.date));
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string; // ISO date
  end: string; // ISO date, inclusive
  note: string;
}

export interface Draft {
  id: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  status: 'draft' | 'sent';
  updated: string;
}

export interface Bill {
  number: string;
  vendor: string;
  reference: string;
  amountCents: number;
  due: string;
  category: string;
  notes: string;
  status: 'Paid' | 'Due';
}

export interface Booking {
  id: string;
  kind: 'flight' | 'hotel';
  itemId: string;
  traveller: string;
  email: string;
  totalCents: number;
  status: 'awaiting-payment' | 'confirmed';
  // What is being bought, in words, as a real checkout shows it.
  summary?: string;
}

export interface SheetRow {
  cells: string[];
}

export interface State {
  emails: Email[];
  events: CalendarEvent[];
  drafts: Draft[];
  bills: Bill[];
  bookings: Booking[];
  sheet: { columns: string[]; rows: SheetRow[] };
  ledgerlySignedIn: boolean;
}

export function freshState(): State {
  return {
    emails: buildEmails(),
    events: [
      { id: 'ev-1', title: 'Board update', start: '2026-11-06', end: '2026-11-06', note: '' },
      { id: 'ev-2', title: 'Quarterly offsite', start: '2026-11-19', end: '2026-11-20', note: 'Accra' },
      { id: 'ev-3', title: 'Payroll run', start: '2026-11-25', end: '2026-11-25', note: '' },
      { id: 'ev-4', title: 'Vendor review', start: '2026-12-08', end: '2026-12-08', note: '' },
    ],
    drafts: [],
    bills: [
      {
        number: 'BL-0418',
        vendor: 'Northgate Paper Co',
        reference: 'NP-7781',
        amountCents: 124000,
        due: '2026-10-20',
        category: 'Office',
        notes: '',
        status: 'Paid',
      },
      {
        number: 'BL-0419',
        vendor: 'Quarry Coffee Supply',
        reference: 'QC-1042',
        amountCents: 38650,
        due: '2026-11-02',
        category: 'Meals',
        notes: '',
        status: 'Due',
      },
      {
        number: 'BL-0420',
        vendor: 'Brightwire Internet',
        reference: 'BW-55120',
        amountCents: 12900,
        due: '2026-11-05',
        category: 'Software',
        notes: '',
        status: 'Due',
      },
    ],
    bookings: [],
    sheet: { columns: ['A', 'B', 'C', 'D'], rows: Array.from({ length: 12 }, () => ({ cells: ['', '', '', ''] })) },
    ledgerlySignedIn: false,
  };
}

// ── Roam travel inventory ───────────────────────────────────────────────

export interface Flight {
  id: string;
  airline: string;
  code: string;
  from: string;
  to: string;
  date: string;
  depart: string;
  arrive: string;
  durationMin: number;
  stops: number;
  via?: string;
  priceCents: number;
}

export interface Hotel {
  id: string;
  name: string;
  area: string;
  walkMinToVenue: number;
  rating: number;
  nightlyCents: number;
  perks: string[];
}

export const AIRPORTS: Record<string, string> = {
  LOS: 'Lagos (LOS)',
  LIS: 'Lisbon (LIS)',
  ACC: 'Accra (ACC)',
  LHR: 'London (LHR)',
  NBO: 'Nairobi (NBO)',
  MAD: 'Madrid (MAD)',
};

const AIRLINES = ['Tagus Airways', 'Sahel Wings', 'Atlantica Air', 'Harmattan Air', 'Meridia'];

// Lagos→Lisbon is hand-written so the film's beats are stable: the best overall pick is $212,
// and the only fare under $200 is $186 with one stop.
const LOS_LIS: Array<Omit<Flight, 'id' | 'from' | 'to' | 'date'>> = [
  {
    airline: 'Tagus Airways',
    code: 'TG 1504',
    depart: '07:40',
    arrive: '14:35',
    durationMin: 355,
    stops: 0,
    priceCents: 21200,
  },
  {
    airline: 'Sahel Wings',
    code: 'SW 311',
    depart: '06:15',
    arrive: '17:05',
    durationMin: 590,
    stops: 1,
    via: 'Madrid',
    priceCents: 18600,
  },
  {
    airline: 'Atlantica Air',
    code: 'AA 88',
    depart: '10:20',
    arrive: '17:20',
    durationMin: 360,
    stops: 0,
    priceCents: 24500,
  },
  {
    airline: 'Harmattan Air',
    code: 'HA 702',
    depart: '13:55',
    arrive: '23:40',
    durationMin: 525,
    stops: 1,
    via: 'Accra',
    priceCents: 20400,
  },
  {
    airline: 'Meridia',
    code: 'MD 19',
    depart: '22:10',
    arrive: '05:15',
    durationMin: 365,
    stops: 0,
    priceCents: 29800,
  },
  {
    airline: 'Atlantica Air',
    code: 'AA 94',
    depart: '16:30',
    arrive: '06:10',
    durationMin: 760,
    stops: 2,
    via: 'Accra, Madrid',
    priceCents: 19900,
  },
];

function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

export function searchFlights(from: string, to: string, date: string): Flight[] {
  const key = `${from}-${to}`;
  const base =
    key === 'LOS-LIS' || key === 'LIS-LOS'
      ? LOS_LIS
      : Array.from({ length: 5 }, (_, i) => {
          const r = rng(hash(key) + i);
          const stops = Math.floor(r() * 3);
          const dep = 6 + Math.floor(r() * 15);
          const dur = 150 + Math.floor(r() * 400) + stops * 120;
          const arr = (dep * 60 + dur) % 1440;
          return {
            airline: AIRLINES[Math.floor(r() * AIRLINES.length)]!,
            code: `${'TSAHM'[i]}${'GWAAD'[i]} ${100 + Math.floor(r() * 800)}`,
            depart: `${String(dep).padStart(2, '0')}:${r() < 0.5 ? '05' : '35'}`,
            arrive: `${String(Math.floor(arr / 60)).padStart(2, '0')}:${String(arr % 60).padStart(2, '0')}`,
            durationMin: dur,
            stops,
            via: stops ? 'Madrid' : undefined,
            priceCents: (140 + Math.floor(r() * 360)) * 100,
          };
        });
  return base.map((f, i) => ({ ...f, id: `${from}${to}${date.replace(/-/g, '')}-${i + 1}`, from, to, date }));
}

export function findFlight(id: string): Flight | undefined {
  const m = id.match(/^([A-Z]{3})([A-Z]{3})(\d{8})-(\d+)$/);
  if (!m) return undefined;
  const date = `${m[3]!.slice(0, 4)}-${m[3]!.slice(4, 6)}-${m[3]!.slice(6)}`;
  return searchFlights(m[1]!, m[2]!, date).find((f) => f.id === id);
}

export const HOTELS: Hotel[] = [
  {
    id: 'casa-doca',
    name: 'Casa Doca',
    area: 'Cais do Sodré',
    walkMinToVenue: 2,
    rating: 4.8,
    nightlyCents: 34000,
    perks: ['Breakfast', 'River view'],
  },
  {
    id: 'ribeira-azul',
    name: 'Hotel Ribeira Azul',
    area: 'Cais do Sodré',
    walkMinToVenue: 6,
    rating: 4.5,
    nightlyCents: 16800,
    perks: ['Breakfast', 'Free cancellation'],
  },
  {
    id: 'lumen',
    name: 'Lumen Lisboa',
    area: 'Chiado',
    walkMinToVenue: 9,
    rating: 4.6,
    nightlyCents: 19200,
    perks: ['Gym'],
  },
  {
    id: 'patio-verde',
    name: 'Pátio Verde Guesthouse',
    area: 'Bica',
    walkMinToVenue: 12,
    rating: 4.2,
    nightlyCents: 13900,
    perks: ['Free cancellation'],
  },
  {
    id: 'alfama-loft',
    name: 'Alfama Loft Rooms',
    area: 'Alfama',
    walkMinToVenue: 31,
    rating: 4.4,
    nightlyCents: 11900,
    perks: [],
  },
  {
    id: 'aero-inn',
    name: 'Aero Inn Lisbon Airport',
    area: 'Airport',
    walkMinToVenue: 95,
    rating: 3.9,
    nightlyCents: 9800,
    perks: ['Airport shuttle'],
  },
];

export const SESSIONS = [
  { time: 'Dec 2 · 09:30', title: 'Opening: the shape of small teams', speaker: 'Inês Duarte', room: 'Main Hall' },
  { time: 'Dec 2 · 11:00', title: 'Hiring your first operations lead', speaker: 'Tomás Reis', room: 'Room A' },
  { time: 'Dec 2 · 14:00', title: 'Finance without a finance team', speaker: 'Leila Haddad', room: 'Room B' },
  { time: 'Dec 3 · 10:00', title: 'Async by default', speaker: 'Marta Sousa', room: 'Room A' },
  { time: 'Dec 3 · 14:00', title: 'Running a small team on fewer tabs', speaker: 'Ama Owusu', room: 'Room B' },
  { time: 'Dec 3 · 16:30', title: 'Vendors, contracts and calm', speaker: 'Rui Almeida', room: 'Main Hall' },
  { time: 'Dec 4 · 10:00', title: 'Closing panel: what we would do again', speaker: 'Panel', room: 'Main Hall' },
];
