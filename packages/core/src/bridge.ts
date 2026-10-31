// The wire protocol between the desktop app (conductor) and the Chrome extension (hands).
// Every frame on the local WebSocket is validated against these schemas on both ends.

import { z } from 'zod';
import { Anchor } from './cue/anchor.js';
import { RecordedStep } from './routine/rehearsal.js';
import { Rect } from './geometry.js';

export { Rect } from './geometry.js';

export const BRIDGE_PORT = 4317;
export const PROTOCOL_VERSION = 1;

export const LaneId = z.string().regex(/^[a-z0-9-]{1,32}$/);
export const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const Bounds = z.object({
  left: z.number().int(),
  top: z.number().int(),
  width: z.number().int().min(200),
  height: z.number().int().min(200),
});
export type Bounds = z.infer<typeof Bounds>;

// One numbered interactive element as the lane sees it.
export const Element = z.object({
  mark: z.number().int().positive(),
  tag: z.string(),
  role: z.string(),
  name: z.string(),
  value: z.string().optional(),
  type: z.string().optional(),
  href: z.string().optional(),
  rect: Rect,
  // Password, one-time-code and payment-card fields: Baton must never type into these.
  blocked: z.boolean().optional(),
  // Signals the safety classifier uses to spot blocked fields (autocomplete, name, id, label).
  hints: z.string().optional(),
  // The form this control belongs to, so the approval gate knows what a click or Enter submits.
  form: z.object({ method: z.string(), action: z.string(), submitLabel: z.string().optional() }).optional(),
  // Options of a <select>, so the lane can choose one by its text.
  options: z.array(z.string()).optional(),
  // Listed but scrolled out of view; acting on it scrolls it into view first.
  offscreen: z.boolean().optional(),
});
export type Element = z.infer<typeof Element>;

const target = { mark: z.number().int().positive().optional(), x: z.number().optional(), y: z.number().optional() };

export const Command = z.discriminatedUnion('op', [
  z.object({ op: z.literal('ping') }),
  z.object({
    op: z.literal('openLane'),
    laneId: LaneId,
    url: z.string().url(),
    color: Color,
    title: z.string().max(80),
    bounds: Bounds.optional(),
  }),
  z.object({ op: z.literal('closeLane'), laneId: LaneId }),
  z.object({ op: z.literal('navigate'), laneId: LaneId, url: z.string().url() }),
  z.object({
    op: z.literal('look'),
    laneId: LaneId,
    maxWidth: z.number().int().min(320).max(2560).default(1280),
    screenshot: z.boolean().default(true),
  }),
  z.object({ op: z.literal('moveCursor'), laneId: LaneId, ...target }),
  z.object({ op: z.literal('click'), laneId: LaneId, ...target }),
  z.object({
    op: z.literal('type'),
    laneId: LaneId,
    mark: z.number().int().positive(),
    text: z.string().max(5000),
    submit: z.boolean().default(false),
  }),
  z.object({
    op: z.literal('key'),
    laneId: LaneId,
    key: z.enum(['Enter', 'Tab', 'Escape', 'Backspace', 'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp']),
  }),
  z.object({
    op: z.literal('scroll'),
    laneId: LaneId,
    dy: z.number().int().default(0),
    mark: z.number().int().positive().optional(),
  }),
  z.object({ op: z.literal('select'), laneId: LaneId, mark: z.number().int().positive(), option: z.string().max(200) }),
  z.object({ op: z.literal('back'), laneId: LaneId }),
  z.object({
    op: z.literal('fillCells'),
    laneId: LaneId,
    mark: z.number().int().positive(),
    rows: z.array(z.array(z.string().max(500)).max(20)).max(60),
  }),
  // A cue starts or ends: content scripts in every tab watch where the pointer rests.
  z.object({ op: z.literal('cueStart'), cueId: z.string().max(64) }),
  z.object({ op: z.literal('cueEnd'), cueId: z.string().max(64), keep: z.boolean() }),
  // Reload one of the person's tabs (after a lane changed what it shows).
  z.object({ op: z.literal('reloadTab'), tabId: z.number().int() }),
  // Rehearsal: record what the person does by hand in their own tabs.
  z.object({ op: z.literal('recordStart') }),
  z.object({ op: z.literal('recordStop') }),
  // Development: pick up a rebuilt extension without a trip to chrome://extensions.
  z.object({ op: z.literal('reloadExtension') }),
  z.object({ op: z.literal('setThinking'), laneId: LaneId, text: z.string().max(140) }),
  // Bring a lane's window to the front, for something only the person can do there.
  z.object({ op: z.literal('focusLane'), laneId: LaneId }),
  // Google Sheets and Docs draw on a canvas: move with the Name Box and the keyboard, read through the file's own export.
  z.object({
    op: z.literal('sheetWrite'),
    laneId: LaneId,
    cell: z.string().max(20),
    rows: z.array(z.array(z.string().max(500)).max(26)).max(60),
  }),
  z.object({ op: z.literal('sheetRead'), laneId: LaneId, range: z.string().max(30).optional() }),
  z.object({ op: z.literal('docWrite'), laneId: LaneId, text: z.string().max(8000) }),
  z.object({ op: z.literal('docRead'), laneId: LaneId }),
]);
export type Command = z.infer<typeof Command>;
export type CommandInput = z.input<typeof Command>;

export const LookResult = z.object({
  url: z.string(),
  title: z.string(),
  viewport: z.object({ width: z.number(), height: z.number() }),
  // Screenshot pixels per CSS pixel, so marks' rects can be drawn onto the image.
  scale: z.number(),
  screenshot: z.string().optional(), // base64 JPEG, marks visible
  elements: z.array(Element),
  text: z.string(),
  // Text a person cannot see (HTML comments, attributes, invisible text), for the injection detector.
  hidden: z.array(z.object({ source: z.enum(['hidden', 'comment', 'attribute']), text: z.string() })).default([]),
  // What Baton cleared out of the way before this look (consent banners, pop-ups), for the receipt.
  tidied: z.array(z.string()).default([]),
  // Something only the person can get past, such as a "check you're human" page. Never solved by Baton.
  blocker: z.object({ kind: z.literal('captcha'), text: z.string().max(300) }).optional(),
  // A consent dialog whose most private choice Baton could not tell: its buttons, for the lane to pick from.
  consent: z.array(z.string().max(120)).max(12).optional(),
  // Editors that draw on a canvas, whose contents are not in the element list.
  app: z.enum(['sheets', 'docs']).optional(),
});
export type LookResult = z.infer<typeof LookResult>;

export const ToExtension = z.discriminatedUnion('type', [
  z.object({ type: z.literal('welcome'), version: z.number() }),
  z.object({ type: z.literal('rejected'), reason: z.string() }),
  z.object({ type: z.literal('command'), id: z.number().int(), command: Command }),
]);
export type ToExtension = z.infer<typeof ToExtension>;

export const LaneEvent = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('laneClosed'), laneId: LaneId }),
  z.object({ kind: z.literal('log'), message: z.string().max(500) }),
  // The person's pointer rested on something during a cue.
  z.object({ kind: z.literal('anchor'), cueId: z.string().max(64), anchor: Anchor }),
  // One thing the person did during a rehearsal.
  z.object({ kind: z.literal('recorded'), step: RecordedStep }),
]);
export type LaneEvent = z.infer<typeof LaneEvent>;

export const FromExtension = z.union([
  z.object({
    type: z.literal('hello'),
    token: z.string().min(16).max(256),
    version: z.number(),
    extensionVersion: z.string(),
  }),
  z.object({ type: z.literal('result'), id: z.number().int(), ok: z.literal(true), data: z.unknown() }),
  z.object({ type: z.literal('result'), id: z.number().int(), ok: z.literal(false), error: z.string() }),
  z.object({ type: z.literal('event'), event: LaneEvent }),
]);
export type FromExtension = z.infer<typeof FromExtension>;

// Parse a raw frame; returns null for anything malformed so callers can drop it and log.
export function parseFrame<T extends z.ZodTypeAny>(schema: T, raw: string): z.infer<T> | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const r = schema.safeParse(value);
  return r.success ? r.data : null;
}
