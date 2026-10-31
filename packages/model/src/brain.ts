// The lane's brain: the core step loop's Brain, answered by Muse Spark Open. Shared by the desktop
// app and Baton Live; only where the model client sends its calls differs.

import {
  LANE_TOOLS,
  ListReply,
  ReadReply,
  StepDecision,
  decisionFromToolCall,
  type Brain,
  type BrainReply,
  type LaneMessage,
} from '@baton/core';
import type OpenAI from 'openai';
import { imagePart, type Model } from './index.js';

export function toOpenAI(messages: LaneMessage[]): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return messages.map((m) =>
    m.role === 'system'
      ? {
          role: 'system',
          content:
            typeof m.content === 'string'
              ? m.content
              : m.content.map((p) => (p.type === 'text' ? p.text : '')).join('\n'),
        }
      : {
          role: 'user',
          content:
            typeof m.content === 'string'
              ? m.content
              : m.content.map((p) =>
                  p.type === 'text' ? { type: 'text' as const, text: p.text } : imagePart(p.jpegBase64),
                ),
        },
  );
}

export class ModelBrain implements Brain {
  constructor(private model: Model) {}
  private async ask<T>(schema: Parameters<Model['json']>[0], messages: LaneMessage[]): Promise<BrainReply<T>> {
    const r = await this.model.json(schema, toOpenAI(messages), 'low');
    return {
      value: r.value as T,
      reasoning: r.reasoning,
      ms: r.ms,
      usage: r.usage && { input: r.usage.input, output: r.usage.output },
      waitMs: r.waitMs,
      callMs: r.callMs,
    };
  }
  // Lane steps use the model's native tool calling, which it follows far more reliably than a
  // JSON format described in the prompt (see the model contract in docs/SPEC.md).
  async decide(messages: LaneMessage[]): Promise<BrainReply<StepDecision>> {
    const r = await this.model.toolStep(
      StepDecision,
      toOpenAI(messages),
      LANE_TOOLS as OpenAI.Chat.Completions.ChatCompletionTool[],
      decisionFromToolCall,
      'low',
      (text) => ({
        thinking: 'Reporting what I found',
        reason: 'The model answered in prose instead of calling a tool; its answer is taken as the result.',
        action: { tool: 'finish', result: text },
      }),
    );
    return {
      value: r.value,
      reasoning: r.reasoning,
      ms: r.ms,
      usage: r.usage && { input: r.usage.input, output: r.usage.output },
      waitMs: r.waitMs,
      callMs: r.callMs,
    };
  }
  read(messages: LaneMessage[]) {
    return this.ask<{ facts: string }>(ReadReply, messages);
  }
  list(messages: LaneMessage[]) {
    return this.ask<{ rows: Array<Record<string, unknown>> }>(ListReply, messages);
  }
}
