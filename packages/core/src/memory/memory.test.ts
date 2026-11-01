import { describe, expect, it } from 'vitest';
import { MemoryBook, holdsSecret, memoryCommand, memoryLines } from './memory.js';

const book = () => {
  let saved: unknown = null;
  const b = new MemoryBook(
    [],
    (items) => (saved = items),
    () => new Date('2026-10-31T12:00:00Z'),
  );
  return { b, saved: () => saved };
};

describe('memory', () => {
  it('saves what the person says to remember, and keeps it in the file', () => {
    const { b, saved } = book();
    const r = b.remember('my hotel budget is under 150 a night');
    expect(r.ok && r.item.label).toBe('hotel budget');
    expect(saved()).toEqual(b.list());
  });

  it('replaces an older memory about the same thing', () => {
    const { b } = book();
    b.remember('my hotel budget is under 150 a night');
    b.remember('my hotel budget is under 120 a night');
    expect(b.list().map((m) => m.text)).toEqual(['my hotel budget is under 120 a night']);
  });

  it('recalls only what is relevant to a request, at most ten items', () => {
    const { b } = book();
    b.remember('my home airport is Lagos');
    b.remember('my hotel budget is under 150 a night');
    b.remember("Maya's email is maya@example.com");
    for (let i = 0; i < 15; i++) b.remember(`my favourite colour number ${i} is blue`);
    const forTrip = b.relevant('Plan a weekend in Lisbon for two with a hotel');
    expect(forTrip.map((m) => m.label)).toContain('hotel budget');
    expect(forTrip.map((m) => m.label)).not.toContain("maya's email");
    expect(forTrip.length).toBeLessThanOrEqual(10);
    expect(b.relevant('Send Maya the plan').map((m) => m.text)).toContain("Maya's email is maya@example.com");
  });

  it('brings back the last plan for "do the same for Porto"', () => {
    const { b } = book();
    b.recordTask(
      'Plan a weekend in Lisbon for two',
      'Plan: weather, three places to eat, a museum open Sunday, written up in the doc.',
      ['https://docs.google.com/document/d/x'],
    );
    const r = b.relevant('Do the same for Porto');
    expect(r[0]!.kind).toBe('task');
    expect(memoryLines(r)).toContain('Plan a weekend in Lisbon for two');
  });

  it('forgets what the person asks it to forget', () => {
    const { b } = book();
    b.remember('my home airport is Lagos');
    b.remember('my hotel budget is under 150 a night');
    const gone = b.forget('my hotel budget');
    expect(gone.map((m) => m.label)).toEqual(['hotel budget']);
    expect(b.list().map((m) => m.label)).toEqual(['home airport']);
    expect(b.forget('something never said')).toEqual([]);
  });

  it('forgets a fact without taking past plans that mention it', () => {
    const { b } = book();
    b.remember('my hotel budget is under 150 a night');
    b.recordTask(
      'Plan a weekend in Lisbon for two',
      'Plan: hotel under 150 a night within budget, museum, restaurants.',
    );
    expect(b.forget('my hotel budget').map((m) => m.kind)).toEqual(['fact']);
    expect(b.list().map((m) => m.kind)).toEqual(['task']);
    expect(b.forget('the Lisbon weekend plan').map((m) => m.kind)).toEqual(['task']);
  });

  it('never stores a password, a card number or a code', () => {
    const { b } = book();
    expect(b.remember('my password is Lagos2026!').ok).toBe(false);
    expect(b.remember('my card is 4111 1111 1111 1111').ok).toBe(false);
    expect(b.remember('the one-time code is 123456').ok).toBe(false);
    expect(holdsSecret('my home airport is Lagos')).toBe(false);
    expect(b.list()).toHaveLength(0);
    expect(b.edit(1, 'cvv 123').ok).toBe(false);
  });

  it('understands the fixed memory phrases without the model', () => {
    expect(memoryCommand('Remember that my hotel budget is under 150 a night.')).toEqual({
      kind: 'remember',
      text: 'my hotel budget is under 150 a night',
    });
    expect(memoryCommand('Forget my hotel budget')).toEqual({ kind: 'forget', text: 'my hotel budget' });
    expect(memoryCommand('What do you remember about me?')).toEqual({ kind: 'recall' });
    expect(memoryCommand('Plan a weekend in Lisbon')).toBeNull();
  });
});
