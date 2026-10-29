// What a lane can do in one step, and the JSON the model must return to choose it.

import { z } from 'zod';

const mark = z.coerce.number().int().positive();
const shortText = (max: number) => z.string().transform((s) => s.replace(/\s+/g, ' ').trim().slice(0, max));

export const Action = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('open_url'), url: z.string().url() }),
  z.object({ tool: z.literal('search_site'), query: z.coerce.string().min(1).max(200) }),
  z.object({ tool: z.literal('click'), mark }),
  z.object({ tool: z.literal('type'), mark, text: z.coerce.string().max(2000), submit: z.boolean().default(false) }),
  z.object({ tool: z.literal('select'), mark, option: z.coerce.string().min(1).max(200) }),
  z.object({ tool: z.literal('scroll'), direction: z.enum(['up', 'down']).optional(), mark: mark.optional() }),
  // Pull facts from the page into the lane's notes, e.g. "the price and airline of the top 3 results".
  z.object({ tool: z.literal('read'), what: z.string().min(1).max(300) }),
  z.object({ tool: z.literal('extract_list'), item: z.string().min(1).max(200), fields: z.array(z.string()).min(1).max(12), max: z.coerce.number().int().min(1).max(50).default(10) }),
  z.object({ tool: z.literal('wait_for'), text: z.coerce.string().min(1).max(200) }),
  z.object({ tool: z.literal('back') }),
  z.object({ tool: z.literal('ask_person'), question: z.string().min(1).max(300) }),
  z.object({ tool: z.literal('finish'), result: z.string().min(1).max(600), data: z.unknown().optional() }),
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
    const { thinking: _t, reason: _r, expect: _e, action: _a, params: _p, args: _g, arguments: _x, parameters: _y, ...rest } = raw;
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
  search_site: { description: "Type into this page's search box and submit.", properties: { query: str('What to search for') }, required: ['query'] },
  click: { description: 'Click a numbered element.', properties: { mark: int('Mark number from the element list') }, required: ['mark'] },
  type: {
    description: "Replace a field's text. submit presses Enter.",
    properties: { mark: int('Mark number of the field'), text: str('Text to enter; dates as YYYY-MM-DD'), submit: { type: 'boolean' } },
    required: ['mark', 'text'],
  },
  select: { description: 'Choose an option in a dropdown by its text.', properties: { mark: int('Mark number of the dropdown'), option: str('Option text') }, required: ['mark', 'option'] },
  scroll: { description: 'Scroll the page, or bring an element into view.', properties: { direction: { type: 'string', enum: ['up', 'down'] }, mark: int('Element to scroll to') }, required: [] },
  read: { description: 'Note facts from the page text into the lane notes.', properties: { what: str('What to note, e.g. "price and time of the first 3 flights"') }, required: ['what'] },
  extract_list: {
    description: 'Copy a list from the page as structured rows.',
    properties: { item: str('What each row is'), fields: { type: 'array', items: { type: 'string' } }, max: int('Most rows to copy') },
    required: ['item', 'fields'],
  },
  wait_for: { description: 'Wait until text appears on the page.', properties: { text: str('Text to wait for') }, required: ['text'] },
  back: { description: 'Go back one page.', properties: {}, required: [] },
  ask_person: { description: 'Ask the person, e.g. to sign in or enter card details, or when stuck.', properties: { question: str('The question') }, required: ['question'] },
  finish: {
    description: 'Stop: the goal is done.',
    properties: { result: str('One-line answer for the person, with exact names, prices, times'), data: { type: 'object', description: 'Structured details' } },
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
        properties: { thinking: str('What you are doing, at most 12 words, for the person'), ...p.properties, reason: str('Why this action'), expect: str('What should change on the page') },
        required: ['thinking', ...p.required],
      },
    },
  };
});

// A native tool call → StepDecision input.
export function decisionFromToolCall(name: string, args: Record<string, unknown>): unknown {
  const { thinking, reason, expect, ...params } = args;
  return { thinking: thinking ?? reason ?? '', reason: reason ?? '', expect: expect ?? '', action: { tool: name, ...params } };
}

// Shape description given to the model; kept beside the schema so they never drift apart.
export const TOOL_GUIDE = `Tools (pick exactly one per step):
- {"tool":"open_url","url":string} go to a URL.
- {"tool":"search_site","query":string} type into this page's search box and submit.
- {"tool":"click","mark":number} click a numbered element.
- {"tool":"type","mark":number,"text":string,"submit":boolean} replace a field's text; submit presses Enter.
- {"tool":"select","mark":number,"option":string} choose an option in a dropdown by its text.
- {"tool":"scroll","direction":"down"|"up"} or {"tool":"scroll","mark":number} scroll the page or bring an element into view.
- {"tool":"read","what":string} note facts from the page text, e.g. "the price and time of the first 3 flights".
- {"tool":"extract_list","item":string,"fields":string[],"max":number} copy a list from the page as structured rows.
- {"tool":"wait_for","text":string} wait until text appears on the page.
- {"tool":"back"} go back one page.
- {"tool":"ask_person","question":string} ask the person when you need them (e.g. to sign in or enter card details) or are stuck.
- {"tool":"finish","result":string,"data":any} stop: the goal is done. result is a one-line answer for the person.`;
