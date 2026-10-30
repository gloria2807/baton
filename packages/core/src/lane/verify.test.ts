import { describe, expect, it } from 'vitest';
import type { Element, LookResult } from '../bridge.js';
import { verify } from './verify.js';

const field = (value: string): Element => ({ mark: 1, tag: 'input', role: 'textbox', name: 'Notes', type: 'text', value, rect: { x: 0, y: 0, w: 100, h: 20 } });
const look = (value: string): LookResult => ({ url: 'http://app.test/new', title: 'New', viewport: { width: 1280, height: 800 }, scale: 1, elements: [field(value)], text: '', hidden: [] });

describe('verify: text fields', () => {
  // A one-line input drops line breaks ("Lisbon\nDetails" becomes "LisbonDetails"); that is still the text typed.
  it('accepts a one-line field that dropped the line breaks of what was typed', () => {
    const typed = 'Doca Hall, Lisbon\nDetails: Room B';
    expect(verify({ tool: 'fill_form', fields: [{ mark: 1, value: typed }] }, look(''), look('Doca Hall, LisbonDetails: Room B')).ok).toBe(true);
    expect(verify({ tool: 'type', mark: 1, text: typed, submit: false }, look(''), look('Doca Hall, LisbonDetails: Room B'), field('')).ok).toBe(true);
  });

  it('still refuses a field that holds something else', () => {
    expect(verify({ tool: 'fill_form', fields: [{ mark: 1, value: 'Doca Hall' }] }, look(''), look('Casa Doca')).ok).toBe(false);
  });
});
