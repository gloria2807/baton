// Rule 1: nothing irreversible without a yes. Before a lane clicks or presses Enter, this decides —
// with fixed rules, never a model — whether the action needs the person's approval.

export type ApprovalCategory =
  'pay' | 'book' | 'buy' | 'send' | 'post' | 'submit' | 'delete' | 'accept-terms' | 'settings';

export interface TargetFacts {
  tag: string;
  role: string;
  name: string; // accessible name / visible text of the element
  type?: string;
  href?: string;
  form?: { method: string; action: string; submitLabel?: string };
}

export interface PageFacts {
  url: string;
  title: string;
}

export type Gate = { kind: 'allow' } | { kind: 'approve'; category: ApprovalCategory; summary: string };

// Checked in this order; the first match decides the category.
const WORDS: Array<[ApprovalCategory, RegExp]> = [
  [
    'delete',
    /\b(delete|remove|trash|discard|erase|destroy|cancel (my |this |the )?(account|subscription|order|booking|reservation|plan)|unsubscribe|deactivate|close (my )?account)\b/i,
  ],
  [
    'pay',
    /\b(pay|payment|checkout|check out|complete (purchase|order|payment)|place (your |my |the )?order|confirm (and )?pay|top up|transfer|donate)\b/i,
  ],
  ['book', /\b(book|reserve|confirm (booking|reservation)|complete booking)\b/i],
  ['buy', /\b(buy|purchase|order now|subscribe|upgrade|start (free )?trial)\b/i],
  ['send', /\b(send|submit (reply|message)|send (reply|message|email|invite|invitation)|invite)\b/i],
  ['post', /\b(post|publish|tweet|share( now)?|comment|reply all)\b/i],
  ['accept-terms', /\b(accept|agree|i agree|consent|allow all|accept all|accept cookies)\b/i],
  [
    'settings',
    /\b(save (changes|settings|preferences)|update (settings|profile|password|email|account)|change (password|email)|apply settings)\b/i,
  ],
];

// Clearly harmless actions even when they submit a form.
const SAFE =
  /\b(search|find|filter|sort|next|previous|back|cancel|close|sign in|log in|login|continue reading|show more|load more|view|open|details)\b/i;

const VERB: Record<ApprovalCategory, string> = {
  pay: 'Pay',
  book: 'Book',
  buy: 'Buy',
  send: 'Send',
  post: 'Post',
  submit: 'Submit',
  delete: 'Delete',
  'accept-terms': 'Accept terms',
  settings: 'Change settings',
};

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function summary(category: ApprovalCategory, label: string, page: PageFacts): string {
  return `${VERB[category]}: “${label.slice(0, 80)}” on ${host(page.url)}`;
}

function isLink(t: TargetFacts): boolean {
  return t.tag === 'a' || t.role === 'link';
}

function isSubmitControl(t: TargetFacts): boolean {
  const type = (t.type ?? '').toLowerCase();
  if (t.tag === 'input') return type === 'submit' || type === 'image';
  // A <button> inside a form submits it unless it says otherwise.
  if (t.tag === 'button') return !!t.form && type !== 'button' && type !== 'reset';
  return false;
}

function settingsPage(page: PageFacts): boolean {
  return /\/(settings|account|preferences|profile|security)\b/i.test(new URL(page.url, 'http://x').pathname);
}

// Gate a click on an element.
export function gateClick(t: TargetFacts, page: PageFacts): Gate {
  const label = t.name.trim() || t.form?.submitLabel || '';
  // Links navigate; only links that destroy something need approval.
  if (isLink(t)) {
    if (WORDS[0]![1].test(t.name))
      return { kind: 'approve', category: 'delete', summary: summary('delete', t.name, page) };
    return { kind: 'allow' };
  }
  for (const [category, re] of WORDS)
    if (re.test(label)) return { kind: 'approve', category, summary: summary(category, label, page) };
  if (isSubmitControl(t)) return gateFormSubmit(t.form!, page, label);
  return { kind: 'allow' };
}

// Gate pressing Enter in a field (which submits its form).
export function gateEnter(t: TargetFacts, page: PageFacts): Gate {
  if (!t.form) return { kind: 'allow' };
  const label = t.form.submitLabel ?? '';
  for (const [category, re] of WORDS)
    if (label && re.test(label)) return { kind: 'approve', category, summary: summary(category, label, page) };
  return gateFormSubmit(t.form, page, label || 'the form');
}

function gateFormSubmit(form: NonNullable<TargetFacts['form']>, page: PageFacts, label: string): Gate {
  // GET forms only read (search, filter); POST forms change something on the server.
  if (form.method.toLowerCase() !== 'post') return { kind: 'allow' };
  if (SAFE.test(label)) return { kind: 'allow' };
  const category: ApprovalCategory = settingsPage(page) ? 'settings' : 'submit';
  return { kind: 'approve', category, summary: summary(category, label, page) };
}

// Pre-approval granted up front (a benchmark task, or later a routine the person approved once).
export interface PreApproval {
  categories: ApprovalCategory[];
  hosts: string[]; // host:port values the pre-approval covers
}

export function isPreApproved(gate: Gate, page: PageFacts, pre?: PreApproval): boolean {
  if (gate.kind !== 'approve' || !pre) return false;
  return pre.categories.includes(gate.category) && pre.hosts.includes(host(page.url));
}

// "yes, book it" approves; "no", "stop", "don't" declines; anything else is not an answer.
export function voiceAnswer(transcript: string): 'approved' | 'declined' | null {
  const t = transcript
    .toLowerCase()
    .replace(/[^a-z' ]/g, ' ')
    .trim();
  if (!t) return null;
  if (/\b(no|nope|don't|do not|stop|cancel|decline|wait|hold on|not now|never mind|nevermind)\b/.test(t))
    return 'declined';
  if (
    /\b(yes|yeah|yep|yup|sure|ok|okay|approve|approved|go ahead|do it|confirm|book it|pay|send it|go for it|please do)\b/.test(
      t,
    )
  )
    return 'approved';
  return null;
}
