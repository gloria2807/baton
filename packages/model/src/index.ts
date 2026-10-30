// The Baseten client for Muse Spark Open, following the Stage 0 model contract in docs/SPEC.md.
// Only the Electron main process constructs this; the API key never leaves it.

import OpenAI from 'openai';
import { z } from 'zod';

export const MODEL = 'meta-models/muse-spark-open-1026';
export const BASE_URL = 'https://inference.baseten.co/v1';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh';

export interface Completion<T> {
  value: T;
  reasoning: string;
  ms: number;
  usage?: { input: number; output: number; reasoning?: number };
}

export class ModelOutputError extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message);
  }
}

type Part = OpenAI.Chat.Completions.ChatCompletionContentPart;
type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

// Pull the JSON object out of an answer, tolerating code fences or stray prose around it.
// Muse Spark Open sometimes answers in its native tool-call channel format instead of the JSON
// asked for, e.g. `<|start|>assistant to=commentary<|message|>…<|eom|><|start|>assistant to=scroll<|message|>{"direction":"up"}<|eot|>`.
// Map that onto {thinking, action}; the caller's schema still validates the result.
export function fromNativeToolCall(text: string): unknown | null {
  if (!text.includes('<|message|>')) return null;
  const parts = [...text.matchAll(/to=([\w.-]+)\s*(?:<\|constrain\|>\w+)?\s*<\|message\|>([\s\S]*?)(?=<\|(?:eom|eot|end|call|return)\|>|<\|start\|>|$)/g)];
  const commentary = parts.filter((p) => p[1] === 'commentary').map((p) => p[2]!.trim()).join(' ');
  const call = parts.filter((p) => p[1] !== 'commentary').at(-1);
  if (!call) return null;
  const tool = call[1]!.replace(/^functions\./, '');
  let args: unknown;
  try {
    args = call[2]!.trim() ? JSON.parse(call[2]!.trim()) : {};
  } catch {
    return null;
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return null;
  const a = args as Record<string, unknown>;
  // Sometimes the body is the whole decision rather than just the tool's arguments.
  if (typeof a.action === 'object' && a.action !== null) return { ...a, thinking: a.thinking ?? commentary };
  return { thinking: commentary, action: { tool, ...a }, reason: commentary };
}

export function extractJson(text: string): unknown {
  const native = fromNativeToolCall(text);
  if (native) return native;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1]! : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('no JSON object in the answer');
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch (e) {
    // Two objects, or prose with braces after the object: take the first balanced object that parses.
    for (const candidate of balancedObjects(body)) {
      try {
        return JSON.parse(candidate);
      } catch {
        /* try the next one */
      }
    }
    throw e;
  }
}

function* balancedObjects(s: string): Generator<string> {
  for (let i = s.indexOf('{'); i >= 0; i = s.indexOf('{', i + 1)) {
    let depth = 0;
    let inString = false;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (inString) {
        if (c === '\\') j++;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        yield s.slice(i, j + 1);
        break;
      }
    }
  }
}

export function audioPart(wav: Uint8Array): Part {
  const url = `data:audio/wav;base64,${Buffer.from(wav).toString('base64')}`;
  // Baseten's audio_url part mirrors image_url; the OpenAI SDK types do not know it.
  return { type: 'audio_url', audio_url: { url } } as unknown as Part;
}

export function imagePart(base64Jpeg: string): Part {
  return { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Jpeg}` } };
}

export const CueHeard = z.object({ transcript: z.string(), intent: z.string() });
export type CueHeard = z.infer<typeof CueHeard>;

export class Model {
  private client: OpenAI;

  constructor(apiKey: string) {
    if (!apiKey) throw new Error('BASETEN_API_KEY is not set');
    this.client = new OpenAI({ baseURL: BASE_URL, apiKey, maxRetries: 2, timeout: 60000 });
  }

  // One JSON answer validated by `schema`. Invalid output is retried once with the error.
  async json<T>(schema: z.ZodType<T>, messages: Message[], effort: Effort = 'low', maxTokens = 8000): Promise<Completion<T>> {
    const t0 = performance.now();
    let convo = messages;
    let lastRaw = '';
    let lastError = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.client.chat.completions.create({
        model: MODEL,
        messages: convo,
        max_tokens: maxTokens,
        reasoning_effort: effort,
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);
      const msg = res.choices[0]?.message as unknown as { content?: string | null; reasoning_content?: string };
      lastRaw = msg?.content ?? '';
      try {
        const value = schema.parse(extractJson(lastRaw));
        const u = res.usage;
        return {
          value,
          reasoning: msg?.reasoning_content ?? '',
          ms: performance.now() - t0,
          usage: u ? { input: u.prompt_tokens, output: u.completion_tokens, reasoning: u.completion_tokens_details?.reasoning_tokens } : undefined,
        };
      } catch (e) {
        lastError = e instanceof z.ZodError ? z.prettifyError(e) : (e as Error).message;
        convo = [
          ...messages,
          { role: 'assistant', content: lastRaw },
          { role: 'user', content: `That reply was not valid: ${lastError}\nReply again with only the JSON object, in exactly the requested shape.` },
        ];
      }
    }
    throw new ModelOutputError(`model output invalid after retry: ${lastError}`, lastRaw);
  }

  // One step through native tool calling: the model must call one of `tools`; `fromToolCall` turns the
  // call into the schema's input. A reply without a tool call falls back to JSON in the content.
  // Invalid output is retried once with the validation error, as for json().
  async toolStep<T>(
    schema: z.ZodType<T>,
    messages: Message[],
    tools: OpenAI.Chat.Completions.ChatCompletionTool[],
    fromToolCall: (name: string, args: Record<string, unknown>) => unknown,
    effort: Effort = 'low',
    // "required" is not airtight: the model occasionally answers in plain prose. The caller decides
    // what such a reply means (for a lane: its final answer).
    fromProse?: (text: string) => unknown,
  ): Promise<Completion<T>> {
    const t0 = performance.now();
    let convo = messages;
    let lastRaw = '';
    let lastError = '';
    const usage = { input: 0, output: 0, reasoning: 0 };
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.client.chat.completions.create({
        model: MODEL,
        messages: convo,
        tools,
        // Enforced by Baseten (measured): the model must call a tool, so it cannot answer in prose.
        tool_choice: 'required',
        max_tokens: 8000,
        reasoning_effort: effort,
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);
      const u = res.usage;
      if (u) {
        usage.input += u.prompt_tokens;
        usage.output += u.completion_tokens;
        usage.reasoning += u.completion_tokens_details?.reasoning_tokens ?? 0;
      }
      const msg = res.choices[0]?.message as unknown as {
        content?: string | null;
        reasoning_content?: string;
        tool_calls?: Array<{ function?: { name: string; arguments: string } }>;
      };
      const call = msg?.tool_calls?.find((c) => c.function)?.function;
      lastRaw = call ? `${call.name}(${call.arguments})` : (msg?.content ?? '');
      try {
        let candidate: unknown;
        if (call) {
          const args = call.arguments?.trim() ? (JSON.parse(call.arguments) as unknown) : {};
          if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new Error('tool arguments are not an object');
          candidate = fromToolCall(call.name, args as Record<string, unknown>);
        } else {
          try {
            candidate = extractJson(lastRaw);
          } catch (e) {
            if (!fromProse || lastRaw.trim().length < 20 || lastRaw.includes('<|')) throw e;
            candidate = fromProse(lastRaw.trim());
          }
        }
        const value = schema.parse(candidate);
        return { value, reasoning: msg?.reasoning_content ?? '', ms: performance.now() - t0, usage };
      } catch (e) {
        lastError = e instanceof z.ZodError ? z.prettifyError(e) : (e as Error).message;
        convo = [
          ...messages,
          { role: 'assistant', content: lastRaw || '(empty reply)' },
          { role: 'user', content: `That was not a valid step: ${lastError}\nCall exactly one of the tools with all its required arguments.` },
        ];
      }
    }
    throw new ModelOutputError(`model output invalid after retry: ${lastError}`, lastRaw);
  }

  // Push-to-talk audio (padded 16 kHz WAV) → transcript and intent.
  transcribeCue(wav: Uint8Array): Promise<Completion<CueHeard>> {
    return this.json(CueHeard, [
      {
        role: 'system',
        content:
          'You are Baton, a voice-driven browser assistant. The audio is a short spoken command from the person, often only a few words, ' +
          'such as "get me there", "put this there", "what is this?", "now do the rest". Transcribe it exactly, then state the intent in a few words. ' +
          'If there is no speech, use an empty transcript.',
      },
      { role: 'user', content: [{ type: 'text', text: 'Reply with JSON only: {"transcript":string,"intent":string}' }, audioPart(wav)] },
    ]);
  }
}
