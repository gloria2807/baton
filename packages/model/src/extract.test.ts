import { describe, expect, it } from 'vitest';
import { extractJson, fromNativeToolCall } from './index.js';

describe('extractJson', () => {
  it('reads plain, fenced and surrounded JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a":1} done')).toEqual({ a: 1 });
  });

  it('takes the first complete object when there is more than one', () => {
    expect(extractJson('{"a":1}\n{"b":2}')).toEqual({ a: 1 });
    expect(extractJson('{"a":"x}"} and then {oops}')).toEqual({ a: 'x}' });
  });

  it('fails when there is no valid object', () => {
    expect(() => extractJson('no json here')).toThrow();
    expect(() => extractJson('{"a": 1,}')).toThrow();
  });
});

describe('native tool-call replies', () => {
  it('maps the channel format onto a lane decision', () => {
    const raw =
      "<|start|>assistant to=commentary<|message|>I noticed the vendor field isn't visible, so I'll re-examine the form.<|eom|><|start|>assistant to=scroll<|message|>{\"direction\":\"up\"}<|eot|>";
    expect(extractJson(raw)).toEqual({
      thinking: "I noticed the vendor field isn't visible, so I'll re-examine the form.",
      action: { tool: 'scroll', direction: 'up' },
      reason: "I noticed the vendor field isn't visible, so I'll re-examine the form.",
    });
  });

  it('handles a call with no commentary and a functions. prefix', () => {
    expect(fromNativeToolCall('<|start|>assistant to=functions.click<|message|>{"mark": 5}<|call|>')).toEqual({ thinking: '', action: { tool: 'click', mark: 5 }, reason: '' });
  });

  it('ignores ordinary JSON and broken calls', () => {
    expect(fromNativeToolCall('{"a":1}')).toBeNull();
    expect(fromNativeToolCall('<|start|>assistant to=click<|message|>{mark: 5<|eot|>')).toBeNull();
    expect(fromNativeToolCall('<|start|>assistant to=commentary<|message|>just talk<|eot|>')).toBeNull();
  });
});

describe('native wrapper around a whole decision', () => {
  it('keeps the inner decision', () => {
    const raw = '<|start|>assistant to=commentary<|message|>Opening the form.<|eom|><|start|>assistant to=open_url<|message|>{"thinking": "Open new bill form", "action": {"tool": "open_url", "url": "http://localhost:4401/bills/new"}, "reason": "r"}<|eot|>';
    expect(extractJson(raw)).toEqual({ thinking: 'Open new bill form', action: { tool: 'open_url', url: 'http://localhost:4401/bills/new' }, reason: 'r' });
  });
});
