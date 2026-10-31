// The Baton benchmark on real websites, in the person's own signed-in Chrome. Everyday tasks across
// the kinds of site Baton must handle: reference pages, weather, maps, a museum, a company list,
// product and review pages, and the person's Google Sheets, Docs, Gmail and Calendar.
//
// Checks never take a lane's word for it. Answers are compared with facts that do not change from
// week to week; writes are checked by reading the sheet, document, drafts or calendar afterwards.
// Every write carries a run token so an old run can never pass a new check.

import type { ApprovalCategory } from '../../packages/core/src/safety/approval.js';

export interface RealEnv {
  token: string; // unique per run, e.g. "BB7K2Q"
  sheetUrl?: string; // the person's test sheet (BATON_TEST_SHEET_URL)
  docUrl?: string; // the person's test document (BATON_TEST_DOC_URL)
}

// What a check may read, without the model: a page's text, a sheet as CSV, a document as text.
export interface RealReader {
  page(url: string): Promise<string>;
  sheet(url: string): Promise<string>;
  doc(url: string): Promise<string>;
}

export interface RealCheckInput {
  text: string; // the lane's (or lanes') results, data and notes
  read: RealReader;
}

export interface RealTask {
  id: string;
  kind: string; // the kind of site, for the table
  request: string; // what the person would say or type
  startUrl: string; // where a single lane starts
  manualSeconds: number;
  preApprove?: Array<{ category: ApprovalCategory; host: string }>;
  needs?: Array<'google' | 'sheet' | 'doc'>;
  check: (i: RealCheckInput) => Promise<{ ok: boolean; detail: string }>;
}

const has = (text: string, ...needles: Array<string | RegExp>) => {
  const missing = needles.filter((n) =>
    typeof n === 'string' ? !text.toLowerCase().includes(n.toLowerCase()) : !n.test(text),
  );
  return { ok: missing.length === 0, detail: missing.length ? `missing ${missing.map(String).join(', ')}` : 'correct' };
};

const temperature = /-?\d{1,2}(\.\d)?\s*°\s*[CF]?|-?\d{1,2}\s*degrees/i;
const duration = /\d+\s*(min|mins|minutes|hr|hrs|hour|hours)\b/i;
const museumOpen = /\b10(\s*[:.]\s*00)?\s*(am|a\.m\.)?\s*(–|-|to|until)/i;
const museumClose = /\b(17\s*[:.]\s*00|5(\s*[:.]\s*00)?\s*(pm|p\.m\.)|17h)/i;

export function realTasks(env: RealEnv): RealTask[] {
  const t = env.token;
  const tasks: RealTask[] = [
    {
      id: 'reference-fact',
      kind: 'reference page',
      request: 'In what year was the Eiffel Tower completed, and how tall is it in metres?',
      startUrl: 'https://en.wikipedia.org/wiki/Eiffel_Tower',
      manualSeconds: 40,
      check: async ({ text }) => has(text, /1889/, /3[0-3]\d(\.\d+)?\s*(m|metres|meters)\b/i),
    },
    {
      id: 'weather-now',
      kind: 'weather site',
      request: 'What is the weather in Lagos, Nigeria right now? Give the temperature and conditions.',
      startUrl: 'https://www.timeanddate.com/weather/nigeria/lagos',
      manualSeconds: 30,
      check: async ({ text }) => has(text, temperature),
    },
    {
      id: 'maps-travel-time',
      kind: 'Google Maps',
      request: 'How long does it take to drive from Ikeja, Lagos to Lekki Phase 1, Lagos?',
      startUrl: 'https://www.google.com/maps',
      manualSeconds: 45,
      check: async ({ text }) => has(text, duration),
    },
    {
      id: 'museum-hours',
      kind: "museum's own site",
      request: 'What are the British Museum’s opening hours for visitors?',
      startUrl: 'https://www.britishmuseum.org/visit',
      manualSeconds: 45,
      check: async ({ text }) => has(text, museumOpen, museumClose),
    },
    {
      id: 'company-list',
      kind: 'public company list',
      request: 'Which three companies are at the top of the list of largest companies by revenue?',
      startUrl: 'https://en.wikipedia.org/wiki/List_of_largest_companies_by_revenue',
      manualSeconds: 40,
      check: async ({ text }) => has(text, 'Walmart', 'Amazon'),
    },
    {
      id: 'product-spec',
      kind: 'product page',
      request: 'What is the battery capacity of The Fairphone (Gen. 6), according to Fairphone’s own website?',
      startUrl: 'https://www.fairphone.com/en/',
      manualSeconds: 60,
      check: async ({ text }) => has(text, /\d[\d,. ]{2,5}\s*mAh/i),
    },
    {
      id: 'review-score',
      kind: 'review site',
      request: 'What is the Tomatometer score of The Godfather (1972) on Rotten Tomatoes?',
      startUrl: 'https://www.rottentomatoes.com/m/the_godfather',
      manualSeconds: 30,
      check: async ({ text }) => has(text, /\b9[6-8]\s*%/),
    },
    {
      id: 'gmail-draft',
      kind: 'Gmail',
      request: `Draft an email (do not send it) with the subject "Baton check ${t}" and the text "The quarterly report is ready." No recipient is needed; leave it in Drafts.`,
      startUrl: 'https://mail.google.com/mail/u/0/#inbox',
      manualSeconds: 45,
      needs: ['google'],
      check: async ({ read }) => {
        const page = await read.page(`https://mail.google.com/mail/u/0/#search/in%3Adraft+${t}`);
        return page.includes(t)
          ? { ok: true, detail: 'draft found in Drafts' }
          : { ok: false, detail: 'no draft with the token' };
      },
    },
    {
      id: 'calendar-event',
      kind: 'Google Calendar',
      request: `Add an all-day event called "Baton check ${t}" on 20 November 2026 to my Google Calendar.`,
      startUrl: 'https://calendar.google.com/calendar/r',
      manualSeconds: 45,
      needs: ['google'],
      preApprove: [{ category: 'submit', host: 'calendar.google.com' }],
      check: async ({ read }) => {
        const page = await read.page(`https://calendar.google.com/calendar/r/search?q=${t}`);
        return page.includes(t)
          ? { ok: true, detail: 'event found in Calendar' }
          : { ok: false, detail: 'no event with the token' };
      },
    },
  ];
  if (env.sheetUrl) {
    const url = env.sheetUrl;
    tasks.push({
      id: 'sheet-write',
      kind: 'Google Sheets',
      request: `In this sheet, starting at cell A1, enter a table with the header row "Item ${t}" and "Qty", then the rows "Pens", "12" and "Notebooks", "5".`,
      startUrl: url,
      manualSeconds: 50,
      needs: ['google', 'sheet'],
      check: async ({ read }) => {
        const csv = await read.sheet(url);
        return has(csv.replace(/"/g, ''), `Item ${t}`, /Pens,12/, /Notebooks,5/);
      },
    });
  }
  if (env.docUrl) {
    const url = env.docUrl;
    tasks.push({
      id: 'doc-write',
      kind: 'Google Docs',
      request: `Add this line at the end of the document: "Baton check ${t}: the team meeting moves to Thursday at 10:00."`,
      startUrl: url,
      manualSeconds: 40,
      needs: ['google', 'doc'],
      check: async ({ read }) => has(await read.doc(url), `Baton check ${t}`, 'Thursday'),
    });
  }
  return tasks;
}

// Requests with several parts, planned by the conductor and run both by one lane and in parallel.
export function realMultiTasks(env: RealEnv): RealTask[] {
  const t = env.token;
  const tasks: RealTask[] = [
    {
      id: 'compare-phones',
      kind: 'product pages',
      request:
        'Compare the battery capacity of The Fairphone (Gen. 6) and the Google Pixel 9, using each maker’s own website.',
      startUrl: 'https://www.fairphone.com/en/',
      manualSeconds: 180,
      check: async ({ text }) => {
        const found = text.match(/\d[\d,. ]{2,5}\s*mAh/gi) ?? [];
        return new Set(found.map((f) => f.replace(/\D/g, ''))).size >= 2 || has(text, /4\s?700\s*mAh/i).ok
          ? { ok: true, detail: `battery figures: ${[...new Set(found)].join(', ')}` }
          : { ok: false, detail: 'fewer than two battery figures' };
      },
    },
    {
      id: 'museum-visit',
      kind: 'museum, weather, maps',
      request:
        "I'm visiting the British Museum this Saturday. Find its opening hours, the weather forecast for London on Saturday, and how long the walk is from King's Cross station.",
      startUrl: 'https://www.britishmuseum.org/visit',
      manualSeconds: 240,
      check: async ({ text }) => has(text, museumOpen, temperature, duration),
    },
    {
      id: 'weather-two-cities',
      kind: 'weather site',
      request: 'What is the weather right now in Lagos and in London?',
      startUrl: 'https://www.timeanddate.com/weather/',
      manualSeconds: 90,
      check: async ({ text }) => {
        const temps = text.match(new RegExp(temperature.source, 'gi')) ?? [];
        return temps.length >= 2
          ? { ok: true, detail: `${temps.length} temperatures` }
          : { ok: false, detail: 'fewer than two temperatures' };
      },
    },
  ];
  if (env.sheetUrl) {
    const url = env.sheetUrl;
    tasks.push({
      id: 'companies-to-sheet',
      kind: 'company list → Sheets',
      request: `Copy the top 5 companies by revenue from Wikipedia's list of largest companies by revenue into my sheet at ${url}, with the heading "Top companies ${t}" in cell D1, then the names and revenues below it in columns D and E.`,
      startUrl: 'https://en.wikipedia.org/wiki/List_of_largest_companies_by_revenue',
      manualSeconds: 240,
      needs: ['google', 'sheet'],
      check: async ({ read }) => has(await read.sheet(url), `Top companies ${t}`, 'Walmart', 'Amazon'),
    });
  }
  return tasks;
}
