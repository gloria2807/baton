// Rule 2: Baton never types into password, one-time-code or payment-card fields.
// Deterministic checks on what the DOM says about a field; no model involved.

export interface FieldFacts {
  tag: string; // lower-case tag name
  type?: string; // input type attribute
  autocomplete?: string;
  name?: string;
  id?: string;
  label?: string; // visible label, aria-label or placeholder text
  inputmode?: string;
}

export type BlockReason = 'password' | 'one-time-code' | 'payment-card';

const AUTOCOMPLETE: Array<[RegExp, BlockReason]> = [
  [/\b(current-password|new-password)\b/, 'password'],
  [/\bone-time-code\b/, 'one-time-code'],
  [/\bcc-(number|csc|exp|exp-month|exp-year|name|type|given-name|family-name|additional-name)\b/, 'payment-card'],
];

// Matched against name, id and label together.
const WORDS: Array<[RegExp, BlockReason]> = [
  [/pass(word|wd|code|phrase)|\bpwd\b|\bpin\b/i, 'password'],
  [/one[\s_-]?time|\botp\b|verification[\s_-]?code|security[\s_-]?code|2fa|mfa|auth(entication)?[\s_-]?code/i, 'one-time-code'],
  [/card[\s_-]?(number|no|num)|\bcc[\s_-]?(num|number|no)?\b|credit[\s_-]?card|debit[\s_-]?card|\bcvc\b|\bcvv\b|\bcsc\b|\bexpir(y|ation)\b|\bexp[\s_-]?date\b|\bmm\s*\/\s*yy\b|\biban\b|account[\s_-]?number|routing[\s_-]?number|sort[\s_-]?code/i, 'payment-card'],
];

export function blockedFieldReason(f: FieldFacts): BlockReason | null {
  const tag = f.tag.toLowerCase();
  const editable = tag === 'input' || tag === 'textarea' || tag === 'select' || f.tag === 'contenteditable';
  if (!editable) return null;
  if ((f.type ?? '').toLowerCase() === 'password') return 'password';
  const ac = (f.autocomplete ?? '').toLowerCase();
  for (const [re, reason] of AUTOCOMPLETE) if (re.test(ac)) return reason;
  const words = [f.name, f.id, f.label].filter(Boolean).join(' ');
  for (const [re, reason] of WORDS) if (re.test(words)) return reason;
  return null;
}

export function blockedFieldMessage(reason: BlockReason): string {
  return {
    password: 'This is a password field. Please type it yourself; Baton never enters passwords.',
    'one-time-code': 'This is a one-time code field. Please enter the code yourself.',
    'payment-card': 'This is a payment card field. Please enter your card details yourself.',
  }[reason];
}
