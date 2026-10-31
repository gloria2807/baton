// What a lane can do in one step, and the JSON the model must return to choose it.

import { z } from 'zod';

const mark = z.coerce.number().int().positive();
// Rows as arrays of cells, or as text with one row per line and tab-separated cells.
const Rows = z.preprocess(
  (v) =>
    typeof v === 'string'
      ? v
          .split(/\r?\n/)
          .filter((l) => l.trim())
          .map((l) => l.split('\t'))
      : v,
  z
    .array(z.array(z.coerce.string().max(500)).min(1).max(20))
    .min(1)
    .max(60),
);
const shortText = (max: number) => z.string().transform((s) => s.replace(/\s+/g, ' ').trim().slice(0, max));

export const Action = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('open_url'), url: z.string().url() }),
  z.object({ tool: z.literal('search_site'), query: z.coerce.string().min(1).max(200) }),
  z.object({ tool: z.literal('click'), mark }),
  z.object({ tool: z.literal('type'), mark, text: z.coerce.string().max(2000), submit: z.boolean().default(false) }),
  z.object({ tool: z.literal('select'), mark, option: z.coerce.string().min(1).max(200) }),
  // Fill several fields of a form in one step (text, dates, dropdowns), then optionally press a button.
  z.object({
    tool: z.literal('fill_form'),
    fields: z
      .array(z.object({ mark, value: z.coerce.string().max(2000) }))
      .min(1)
      .max(30),
    submit: mark.optional(),
  }),
  // Enter a block of rows into a grid of fields (a sheet), starting at the cell `mark`.
  z.object({ tool: z.literal('fill_cells'), mark, rows: Rows }),
  z.object({ tool: z.literal('scroll'), direction: z.enum(['up', 'down']).optional(), mark: mark.optional() }),
  // Pull facts from the page into the lane's notes, e.g. "the price and airline of the top 3 results".
  z.object({
    tool: z.literal('read'),
    what: z
      .string()
      .min(1)
      .transform((s) => s.trim().slice(0, 300)),
  }),
  z.object({
    tool: z.literal('extract_list'),
    item: z.string().min(1).max(200),
    fields: z.array(z.string()).min(1).max(12),
    max: z.coerce.number().int().min(1).max(50).default(10),
  }),
  z.object({ tool: z.literal('wait_for'), text: z.coerce.string().min(1).max(200) }),
  z.object({ tool: z.literal('back') }),
  // Google Sheets and Docs: their contents are drawn on a canvas, so they have their own tools.
  z.object({
    tool: z.literal('sheet_write'),
    cell: z.string().regex(/^[A-Za-z]{1,3}[0-9]{1,7}$/, 'a cell like B4'),
    rows: Rows,
  }),
  z.object({ tool: z.literal('sheet_read'), range: z.string().max(30).optional() }),
  z.object({ tool: z.literal('doc_write'), text: z.coerce.string().min(1).max(8000) }),
  z.object({ tool: z.literal('doc_read') }),
  // A reliable trick for this site, kept in Baton's site notes for the next lane (the person can review them).
  z.object({
    tool: z.literal('note_site'),
    note: z
      .string()
      .min(5)
      .transform((s) => s.replace(/\s+/g, ' ').trim().slice(0, 300)),
  }),
  // Long questions are cut, not refused: a refused step stalls the lane over a few extra words.
  z.object({
    tool: z.literal('ask_person'),
    question: z
      .string()
      .min(1)
      .transform((s) => s.trim().slice(0, 600)),
  }),
  // Long answers are trimmed rather than rejected: a finished lane should not fail on length.
  z.object({
    tool: z.literal('finish'),
    result: z
      .string()
      .min(1)
      .transform((s) => (s.length > 1200 ? `${s.slice(0, 1199)}…` : s)),
    data: z.unknown().optional(),
  }),
]);
export type Action = z.infer<typeof Action>;
export type Tool = Action['tool'];

const TOOLS = new Set<string>(Action.options.map((o) => o.shape.tool.value));
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// Models sometimes return a sound decision in a slightly different shape. Map the known variants
// onto the contract before validating; anything else still fails validation.
export function normalizeDecision(raw: unknown): unknown {
  if (!isObj(raw)) return raw;
  const out: Record<string, unknown> = { ...raw };
  let action = raw.action;
  // {"tool":"click","mark":5,"thinking":...}: the action is flattened into the top level.
  if (action === undefined && typeof raw.tool === 'string') {
    const { thinking: _t, reason: _r, expect: _e, ...rest } = raw;
    action = rest;
  }
  // {"action":"click","mark":5} or {"action":"click","params":{...}}
  if (typeof action === 'string' && TOOLS.has(action)) {
    const params = [raw.params, raw.args, raw.arguments, raw.parameters].find(isObj) ?? {};
    const {
      thinking: _t,
      reason: _r,
      expect: _e,
      action: _a,
      params: _p,
      args: _g,
      arguments: _x,
      parameters: _y,
      ...rest
    } = raw;
    action = { tool: action, ...rest, ...params };
  }
  // {"action":{"name":"click","arguments":{...}}} (tool-call style)
  if (isObj(action) && action.tool === undefined && typeof action.name === 'string' && TOOLS.has(action.name)) {
    const params = [action.arguments, action.params, action.args].find(isObj) ?? {};
    action = { tool: action.name, ...params };
  }
  out.action = action;
  if (typeof out.thinking !== 'string') out.thinking = typeof raw.reason === 'string' ? raw.reason : '';
  return out;
}

export const StepDecision = z.preprocess(
  normalizeDecision,
  z.object({
    thinking: shortText(120), // one line shown on the lane's title bar
    action: Action,
    expect: shortText(200).default(''), // what should change, checked after acting
    reason: shortText(240).default(''),
  }),
);
export type StepDecision = z.infer<typeof StepDecision>;

// The same tools as function definitions for the model's native tool calling (OpenAI format).
// Each also takes thinking / reason / expect, which become the rest of the StepDecision.
type JsonSchema = Record<string, unknown>;
const str = (description: string): JsonSchema => ({ type: 'string', description });
const int = (description: string): JsonSchema => ({ type: 'integer', description });
const TOOL_PARAMS: Record<Tool, { description: string; properties: Record<string, JsonSchema>; required: string[] }> = {
  open_url: { description: 'Go to a URL.', properties: { url: str('Full URL') }, required: ['url'] },
  search_site: {
    description: "Type into this page's search box and submit.",
    properties: { query: str('What to search for') },
    required: ['query'],
  },
  click: {
    description: 'Click a numbered element.',
    properties: { mark: int('Mark number from the element list') },
    required: ['mark'],
  },
  type: {
    description: "Replace a field's text. submit presses Enter.",
    properties: {
      mark: int('Mark number of the field'),
      text: str('Text to enter; dates as YYYY-MM-DD'),
      submit: { type: 'boolean' },
    },
    required: ['mark', 'text'],
  },
  select: {
    description: 'Choose an option in a dropdown by its text.',
    properties: { mark: int('Mark number of the dropdown'), option: str('Option text') },
    required: ['mark', 'option'],
  },
  fill_form: {
    description:
      'Fill several fields of a form in one step: text boxes, dates (YYYY-MM-DD) and dropdowns (option text), then optionally press the submit/continue button. Prefer this to typing fields one by one. Off-screen fields can be filled directly.',
    properties: {
      fields: {
        type: 'array',
        items: {
          type: 'object',
          properties: { mark: { type: 'integer' }, value: { type: 'string' } },
          required: ['mark', 'value'],
        },
        description: 'Each field mark and the value to put in it',
      },
      submit: int('Mark of the button to press after filling, if the form should be submitted'),
    },
    required: ['fields'],
  },
  fill_cells: {
    description:
      'Enter a block of rows into a grid of fields (a sheet or table of inputs) in one step, starting at the cell given by mark and filling right and down.',
    properties: {
      mark: int('Mark number of the top-left cell to fill'),
      rows: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'Rows of cell values' },
    },
    required: ['mark', 'rows'],
  },
  scroll: {
    description: 'Scroll the page, or bring an element into view.',
    properties: { direction: { type: 'string', enum: ['up', 'down'] }, mark: int('Element to scroll to') },
    required: [],
  },
  read: {
    description: 'Note facts from the page text into the lane notes.',
    properties: { what: str('What to note, e.g. "price and time of the first 3 flights"') },
    required: ['what'],
  },
  extract_list: {
    description: 'Copy a list from the page as structured rows.',
    properties: {
      item: str('What each row is'),
      fields: { type: 'array', items: { type: 'string' } },
      max: int('Most rows to copy'),
    },
    required: ['item', 'fields'],
  },
  wait_for: {
    description: 'Wait until text appears on the page.',
    properties: { text: str('Text to wait for') },
    required: ['text'],
  },
  back: { description: 'Go back one page.', properties: {}, required: [] },
  sheet_write: {
    description:
      'Google Sheets only: go to a cell with the Name Box and type rows of values with the keyboard, filling right and down from that cell.',
    properties: {
      cell: str('Top-left cell, like B4'),
      rows: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'Rows of cell values' },
    },
    required: ['cell', 'rows'],
  },
  sheet_read: {
    description: "Google Sheets only: read the sheet's values as CSV (optionally just a range like A1:D20).",
    properties: { range: str('Optional range, like A1:D20') },
    required: [],
  },
  doc_write: {
    description:
      'Google Docs only: type text at the end of the document with the keyboard. New lines start new paragraphs.',
    properties: { text: str('Text to type') },
    required: ['text'],
  },
  doc_read: { description: "Google Docs only: read the document's text.", properties: {}, required: [] },
  note_site: {
    description:
      'Save a short, reliable tip about how this site works, for future lanes (e.g. "Search results load only after pressing Enter"). Only for tricks that worked.',
    properties: { note: str('The tip, one sentence') },
    required: ['note'],
  },
  ask_person: {
    description: 'Ask the person, e.g. to sign in or enter card details, or when stuck.',
    properties: { question: str('The question') },
    required: ['question'],
  },
  finish: {
    description: 'Stop: the goal is done.',
    properties: {
      result: str('One-line answer for the person, with exact names, prices, times'),
      data: { type: 'object', description: 'Structured details' },
    },
    required: ['result'],
  },
};

export const LANE_TOOLS = (Object.keys(TOOL_PARAMS) as Tool[]).map((name) => {
  const p = TOOL_PARAMS[name];
  return {
    type: 'function' as const,
    function: {
      name,
      description: p.description,
      parameters: {
        type: 'object',
        properties: {
          thinking: str('What you are doing, at most 12 words, for the person'),
          ...p.properties,
          reason: str('Why this action'),
          expect: str('What should change on the page'),
        },
        required: ['thinking', ...p.required],
      },
    },
  };
});

// A native tool call → StepDecision input.
export function decisionFromToolCall(name: string, args: Record<string, unknown>): unknown {
  const { thinking, reason, expect, ...params } = args;
  return {
    thinking: thinking ?? reason ?? '',
    reason: reason ?? '',
    expect: expect ?? '',
    action: { tool: name, ...params },
  };
}

// Shape description given to the model; kept beside the schema so they never drift apart.
export const TOOL_GUIDE = `Tools (pick exactly one per step):
- {"tool":"open_url","url":string} go to a URL.
- {"tool":"search_site","query":string} type into this page's search box and submit.
- {"tool":"click","mark":number} click a numbered element.
- {"tool":"type","mark":number,"text":string,"submit":boolean} replace a field's text; submit presses Enter.
- {"tool":"select","mark":number,"option":string} choose an option in a dropdown by its text.
- {"tool":"fill_form","fields":[{"mark":number,"value":string}],"submit":number} fill a whole form in one step, then optionally press a button.
- {"tool":"fill_cells","mark":number,"rows":string[][]} enter many rows into a sheet at once, starting at the top-left cell mark.
- {"tool":"scroll","direction":"down"|"up"} or {"tool":"scroll","mark":number} scroll the page or bring an element into view.
- {"tool":"read","what":string} note facts from the page text, e.g. "the price and time of the first 3 flights".
- {"tool":"extract_list","item":string,"fields":string[],"max":number} copy a list from the page as structured rows.
- {"tool":"wait_for","text":string} wait until text appears on the page.
- {"tool":"back"} go back one page.
- {"tool":"sheet_write","cell":"B4","rows":string[][]} Google Sheets: type rows of values starting at a cell.
- {"tool":"sheet_read","range":"A1:D20"} Google Sheets: read values as CSV (range optional).
- {"tool":"doc_write","text":string} Google Docs: type text at the end of the document.
- {"tool":"doc_read"} Google Docs: read the document's text.
- {"tool":"note_site","note":string} save a reliable tip about this site for future lanes.
- {"tool":"ask_person","question":string} ask the person when you need them (e.g. to sign in or enter card details) or are stuck.
- {"tool":"finish","result":string,"data":any} stop: the goal is done. result is a one-line answer for the person.`;
