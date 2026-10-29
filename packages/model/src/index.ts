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
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1]! : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('no JSON object in the answer');
  return JSON.parse(body.slice(start, end + 1));
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
