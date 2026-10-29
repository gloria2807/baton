// Rule 3: web pages are data, never instructions. This cheap, deterministic detector flags text
// on a page that tries to instruct an AI agent, wherever it hides: visible text, invisible text,
// HTML comments or attributes. A flagged page pauses the lane and the person sees the text.

export interface PageTextSource {
  source: 'visible' | 'hidden' | 'comment' | 'attribute';
  text: string;
}

export interface InjectionFinding {
  source: PageTextSource['source'];
  text: string; // the offending passage, trimmed for display
  why: string[];
}

// Words that address an AI system rather than a human reader.
const ADDRESSES_AI =
  /\b(ai|a\.i\.)[\s-]*(assistants?|agents?|models?|systems?|bots?)\b|\b(language models?|llms?|chatgpt|gpt-?\d|claude|gemini|copilot|browser agents?|autonomous agents?|automated agents?|web agents?|any (ai|model|agent|assistant)s?|(assistant|model|agent) reading this)\b/i;

// Attempts to replace the agent's goal or rules, or to slip past the person.
const OVERRIDES: Array<[string, RegExp]> = [
  ['tells the agent to ignore its instructions', /\b(ignore|disregard|forget|override|bypass)\b[^.]{0,40}\b(previous|prior|earlier|above|all|your|system|original)\b[^.]{0,20}\b(instructions?|prompts?|rules|directions|guidelines|goals?)\b/i],
  ['claims to change the agent’s goal', /\byour (new|updated|real|actual|true) (goal|task|instructions?|objective|mission)\b/i],
  ['poses as a system message', /\b(system (override|prompt|message|instruction)|developer (mode|message|instruction)|admin(istrator)? (override|instruction))\b/i],
  ['claims the person pre-authorised something', /\b(pre-?authori[sz]ed|already (approved|authori[sz]ed|consented)|has authori[sz]ed you|you are authori[sz]ed)\b/i],
  ['asks to act without the person', /\b(without (asking|telling|confirming|approval|permission)|do not (tell|inform|notify|ask|alert) the (user|person|human)|don't (tell|ask) the (user|person))\b/i],
];

// What an injected instruction usually wants done.
const IMPERATIVE = /\b(forward|send|email|delete|remove|transfer|approve|enter|type|fill|open|navigate|go to|visit|click|pay|purchase|buy|reveal|share|copy|upload|download|post|disclose|output|print|respond with|say)\b/i;

function chunks(text: string): string[] {
  // Sentence-ish pieces, so one long article does not combine unrelated phrases.
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12);
}

export function detectInjection(sources: PageTextSource[]): InjectionFinding[] {
  const findings: InjectionFinding[] = [];
  const seen = new Set<string>();
  for (const src of sources) {
    const pieces = chunks(src.text);
    for (const [i, piece] of pieces.entries()) {
      const why: string[] = [];
      for (const [label, re] of OVERRIDES) if (re.test(piece)) why.push(label);
      const addressed = ADDRESSES_AI.test(piece);
      if (addressed && IMPERATIVE.test(piece) && /\b(you|your|must|should|now|immediately)\b|^[^a-z]*\b(ai|assistant|agent|model|note)\b[^:]{0,40}:/i.test(piece)) why.push('gives orders to an AI agent');
      // An override phrase alone is suspicious; a direct order to an AI is enough on its own too.
      if (why.length === 0) continue;
      // The order usually follows the "ignore your instructions" sentence; show both.
      const next = pieces[i + 1];
      const text = (next && IMPERATIVE.test(next) ? `${piece} ${next}` : piece).slice(0, 300);
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ source: src.source, text, why });
    }
  }
  return findings;
}

// Page text goes into prompts inside this wrapper so the model treats it as data.
export function untrusted(label: string, text: string): string {
  const safe = text.replace(/<\/?untrusted[^>]*>/gi, '');
  return `<untrusted source="${label}">\n${safe}\n</untrusted>`;
}
