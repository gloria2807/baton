// Anchors: what the person pointed at while speaking a cue. Captured in Chrome by the content
// script, or on the desktop by a screenshot around the pointer (read-only questions only).

import { z } from 'zod';
import { Rect } from '../geometry.js';

export const AnchorTarget = z.object({
  tag: z.string(),
  role: z.string(),
  // What the person would call it: the heading, the email subject, the table caption…
  label: z.string().max(300),
  text: z.string().max(4000),
  href: z.string().optional(),
  image: z.object({ src: z.string().max(500), alt: z.string().max(300) }).optional(),
  // A table under the pointer, as rows of cell text; editable when its cells are inputs (a sheet).
  table: z
    .object({
      rows: z.array(z.array(z.string().max(300))).max(60),
      editable: z.boolean(),
      pointedRow: z.number().int().optional(),
    })
    .optional(),
});
export type AnchorTarget = z.infer<typeof AnchorTarget>;

export const Anchor = z.object({
  n: z.number().int().positive(), // the number on the pin, in order of pointing
  at: z.number().int().nonnegative(), // ms after the talk key went down
  source: z.enum(['chrome', 'desktop']),
  url: z.string().optional(),
  title: z.string().optional(),
  tabId: z.number().int().optional(),
  laneId: z.string().optional(), // set when the person pointed at a lane window
  point: z.object({ x: z.number(), y: z.number() }),
  rect: Rect.optional(),
  target: AnchorTarget.optional(),
  screenshot: z.string().optional(), // JPEG base64 crop around the anchor
});
export type Anchor = z.infer<typeof Anchor>;

// One-line description for the Podium and for prompts.
export function describeAnchor(a: Anchor): string {
  if (a.source === 'desktop') return 'something on the desktop (screenshot)';
  const t = a.target;
  const where = a.title ? ` on “${a.title.slice(0, 50)}”` : '';
  if (!t) return `a point${where}`;
  if (t.table) return `${t.table.editable ? 'a sheet' : 'a table'} (${t.table.rows.length} rows)${where}`;
  if (t.image) return `an image “${t.image.alt || t.label}”${where}`;
  return `${t.role} “${(t.label || t.text).replace(/\s+/g, ' ').slice(0, 60)}”${where}`;
}
