import { describe, expect, it } from 'vitest';
import { Action, LANE_TOOLS, StepDecision, decisionFromToolCall } from './actions.js';

describe('StepDecision', () => {
  it('accepts the contract shape', () => {
    expect(StepDecision.parse({ thinking: 'Opening the form', action: { tool: 'click', mark: 5 }, expect: 'form opens', reason: 'start' })).toEqual({
      thinking: 'Opening the form',
      action: { tool: 'click', mark: 5 },
      expect: 'form opens',
      reason: 'start',
    });
  });

  it('maps known variants onto the contract', () => {
    expect(StepDecision.parse({ tool: 'click', mark: 5, thinking: 'x' }).action).toEqual({ tool: 'click', mark: 5 });
    expect(StepDecision.parse({ action: 'type', mark: '3', text: 'hi', reason: 'r' })).toMatchObject({ thinking: 'r', action: { tool: 'type', mark: 3, text: 'hi', submit: false } });
    expect(StepDecision.parse({ thinking: 't', action: 'scroll', params: { direction: 'down' } }).action).toEqual({ tool: 'scroll', direction: 'down' });
    expect(StepDecision.parse({ thinking: 't', action: { name: 'finish', arguments: { result: 'done' } } }).action).toEqual({ tool: 'finish', result: 'done' });
  });

  it('still rejects what is not a valid action', () => {
    for (const bad of [null, 'click 5', {}, { thinking: 't' }, { action: 'hack', mark: 1 }, { action: { tool: 'click' } }, { action: { tool: 'open_url', url: 'not a url' } }])
      expect(StepDecision.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });

  it('trims the thinking line for the title bar', () => {
    expect(StepDecision.parse({ thinking: 'x'.repeat(300), action: { tool: 'back' } }).thinking).toHaveLength(120);
  });
});

describe('native tool calls', () => {
  it('defines one function per lane tool, each asking for a thinking line', () => {
    expect(LANE_TOOLS.map((t) => t.function.name).sort()).toEqual(Action.options.map((o) => o.shape.tool.value).sort());
    for (const t of LANE_TOOLS) expect(t.function.parameters.required[0]).toBe('thinking');
  });

  it('turns a tool call into a valid decision', () => {
    expect(StepDecision.parse(decisionFromToolCall('type', { thinking: 'Setting walk filter', mark: 8, text: '10', reason: 'filter', expect: 'field holds 10' }))).toEqual({
      thinking: 'Setting walk filter',
      action: { tool: 'type', mark: 8, text: '10', submit: false },
      reason: 'filter',
      expect: 'field holds 10',
    });
    expect(StepDecision.safeParse(decisionFromToolCall('click', { thinking: 'x' })).success).toBe(false); // no mark
  });
});

describe('numbers where text is expected', () => {
  it('are written as text', () => {
    expect(StepDecision.parse(decisionFromToolCall('type', { thinking: 't', mark: 7, text: 200 })).action).toEqual({ tool: 'type', mark: 7, text: '200', submit: false });
    expect(StepDecision.parse(decisionFromToolCall('type', { thinking: 't', mark: 2, text: 1234.56 })).action).toMatchObject({ text: '1234.56' });
  });
});
