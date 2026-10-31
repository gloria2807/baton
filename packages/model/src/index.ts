// The Baseten client for Muse Spark Open, following the Stage 0 model contract in docs/SPEC.md.
// The desktop app constructs this in its main process with the key, which never leaves it. Baton Live
// constructs it in the browser pointed at its own proxy, with no key at all: the proxy adds it.

import OpenAI from 'openai';
import { z } from 'zod';
import type { Governor } from './governor.js';

export * from './governor.js';

export const MODEL = 'meta-models/muse-spark-open-1026';
export const BASE_URL = 'https://inference.baseten.co/v1';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh';

export interface Completion<T> {
  value: T;
  reasoning: string;
  ms: number;
  usage?: { input: number; output: number; reasoning?: number };
  // Where the time went: waiting for the governor's turn, and the model call itself.
  waitMs?: number;
  callMs?: number;
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
  const parts = [
    ...text.matchAll(
      /to=([\w.-]+)\s*(?:<\|constrain\|>\w+)?\s*<\|message\|>([\s\S]*?)(?=<\|(?:eom|eot|end|call|return)\|>|<\|start\|>|$)/g,
    ),
  ];
  const commentary = parts
    .filter((p) => p[1] === 'commentary')
    .map((p) => p[2]!.trim())
    .join(' ');
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

// Base64 without Node's Buffer, so the client also runs in a browser.
export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function audioPart(wav: Uint8Array): Part {
  const url = `data:audio/wav;base64,${toBase64(wav)}`;
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

  // With a governor, every call is counted against the daily budget, limited in concurrency and
  // retried patiently on rate limits; the SDK's own retries are then turned off.
  // `proxyURL` (Baton Live): send calls to that proxy instead of Baseten. The proxy holds the key, so
  // `apiKey` is then only a placeholder.
  constructor(
    apiKey: string,
    readonly governor?: Governor,
    proxyURL?: string,
  ) {
    if (!apiKey) throw new Error('BASETEN_API_KEY is not set');
    this.client = new OpenAI({
      baseURL: proxyURL ?? BASE_URL,
      apiKey,
      maxRetries: governor ? 0 : 2,
      timeout: 60000,
      dangerouslyAllowBrowser: !!proxyURL,
    });
  }

  // `clock` collects time spent waiting for a turn and time spent in the call (retries included).
  private async create(
    params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
    clock?: { waitMs: number; callMs: number },
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    const queued = performance.now();
    let started = 0;
    const call = () => {
      started ||= performance.now();
      return this.client.chat.completions.create(params);
    };
    const res = await (this.governor ? this.governor.run(call) : call());
    if (clock) {
      clock.waitMs += started - queued;
      clock.callMs += performance.now() - started;
    }
    return res;
  }

  // One JSON answer validated by `schema`. Invalid output is retried once with the error.
  async json<T>(
    schema: z.ZodType<T>,
    messages: Message[],
    effort: Effort = 'low',
    maxTokens = 8000,
  ): Promise<Completion<T>> {
    const t0 = performance.now();
    const clock = { waitMs: 0, callMs: 0 };
    let convo = messages;
    let lastRaw = '';
    let lastError = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.create(
        {
          model: MODEL,
          messages: convo,
          max_tokens: maxTokens,
          reasoning_effort: effort,
        } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
        clock,
      );
      const msg = res.choices[0]?.message as unknown as { content?: string | null; reasoning_content?: string };
      lastRaw = msg?.content ?? '';
      try {
        const value = schema.parse(extractJson(lastRaw));
        const u = res.usage;
        return {
          value,
          reasoning: msg?.reasoning_content ?? '',
          ms: performance.now() - t0,
          ...clock,
          usage: u
            ? {
                input: u.prompt_tokens,
                output: u.completion_tokens,
                reasoning: u.completion_tokens_details?.reasoning_tokens,
              }
            : undefined,
        };
      } catch (e) {
        lastError = e instanceof z.ZodError ? z.prettifyError(e) : (e as Error).message;
        convo = [
          ...messages,
          { role: 'assistant', content: lastRaw },
          {
            role: 'user',
            content: `That reply was not valid: ${lastError}\nReply again with only the JSON object, in exactly the requested shape.`,
          },
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
    const clock = { waitMs: 0, callMs: 0 };
    let convo = messages;
    let lastRaw = '';
    let lastError = '';
    const usage = { input: 0, output: 0, reasoning: 0 };
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.create(
        {
          model: MODEL,
          messages: convo,
          tools,
          // Enforced by Baseten (measured): the model must call a tool, so it cannot answer in prose.
          tool_choice: 'required',
          max_tokens: 8000,
          reasoning_effort: effort,
        } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
        clock,
      );
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
          if (typeof args !== 'object' || args === null || Array.isArray(args))
            throw new Error('tool arguments are not an object');
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
        return { value, reasoning: msg?.reasoning_content ?? '', ms: performance.now() - t0, usage, ...clock };
      } catch (e) {
        lastError = e instanceof z.ZodError ? z.prettifyError(e) : (e as Error).message;
        convo = [
          ...messages,
          { role: 'assistant', content: lastRaw || '(empty reply)' },
          {
            role: 'user',
            content: `That was not a valid step: ${lastError}\nCall exactly one of the tools with all its required arguments.`,
          },
        ];
      }
    }
    throw new ModelOutputError(`model output invalid after retry: ${lastError}`, lastRaw);
  }

  // One streamed JSON answer. `onReasoning` and `onContent` get the text so far as it arrives; the
  // finished answer is validated with `schema`, and an invalid one is asked for again (unstreamed)
  // with the error, as json() does. Usage counts against the governor like any other call.
  async streamJson<T>(
    schema: z.ZodType<T>,
    messages: Message[],
    effort: Effort,
    on: { onReasoning?: (all: string) => void; onContent?: (all: string) => void },
  ): Promise<Completion<T>> {
    const t0 = performance.now();
    let content = '';
    let reasoning = '';
    let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
    const run = async () => {
      content = '';
      reasoning = '';
      const stream = (await this.client.chat.completions.create({
        model: MODEL,
        messages,
        max_tokens: 8000,
        reasoning_effort: effort,
        stream: true,
        stream_options: { include_usage: true },
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming)) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
      for await (const chunk of stream) {
        const d = chunk.choices[0]?.delta as { content?: string | null; reasoning_content?: string | null } | undefined;
        if (d?.reasoning_content) {
          reasoning += d.reasoning_content;
          on.onReasoning?.(reasoning);
        }
        if (d?.content) {
          content += d.content;
          on.onContent?.(content);
        }
        if (chunk.usage) usage = chunk.usage;
      }
      // If the server sends no usage, count an over-estimate rather than nothing, so the budget holds.
      usage ??= {
        prompt_tokens: Math.ceil(JSON.stringify(messages).length / 3),
        completion_tokens: Math.ceil((content.length + reasoning.length) / 3),
      };
      return { usage };
    };
    await (this.governor ? this.governor.run(run) : run());
    try {
      const value = schema.parse(extractJson(content));
      return {
        value,
        reasoning,
        ms: performance.now() - t0,
        usage: usage && { input: usage.prompt_tokens ?? 0, output: usage.completion_tokens ?? 0 },
      };
    } catch (e) {
      const error = e instanceof z.ZodError ? z.prettifyError(e) : (e as Error).message;
      return this.json(
        schema,
        [
          ...messages,
          { role: 'assistant', content },
          {
            role: 'user',
            content: `That reply was not valid: ${error}\nReply again with only the JSON object, in exactly the requested shape.`,
          },
        ],
        effort,
      );
    }
  }

  // Opens the connection to Baseten while the person is still speaking, so the call after release
  // does not wait for TLS. Listing models is free.
  warm(): void {
    void this.client.models.list().catch(() => undefined);
  }

  // The fast voice pipeline: the padded recording plus the pins and profile, in one streamed call.
  listen<T>(
    schema: z.ZodType<T>,
    wav: Uint8Array,
    system: string,
    text: string,
    on: { onReasoning?: (all: string) => void; onContent?: (all: string) => void },
  ): Promise<Completion<T>> {
    return this.streamJson(
      schema,
      [
        { role: 'system', content: system },
        { role: 'user', content: [{ type: 'text', text }, audioPart(wav)] },
      ],
      'low',
      on,
    );
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
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Reply with JSON only: {"transcript":string,"intent":string}' },
          audioPart(wav),
        ],
      },
    ]);
  }
}
export * from './brain.js';
