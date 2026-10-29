import { describe, expect, it } from 'vitest';
import { gateClick, gateEnter, isPreApproved, voiceAnswer, type TargetFacts } from './approval.js';

const roam = { url: 'http://localhost:4402/book/flight/x', title: 'Roam' };
const ledgerly = { url: 'http://localhost:4401/bills/new', title: 'Ledgerly' };
const post = (submitLabel?: string) => ({ method: 'post', action: '/x', submitLabel });
const get = (submitLabel?: string) => ({ method: 'get', action: '/x', submitLabel });
const button = (name: string, extra: Partial<TargetFacts> = {}): TargetFacts => ({ tag: 'button', role: 'button', name, ...extra });
const link = (name: string, href = 'http://localhost/x'): TargetFacts => ({ tag: 'a', role: 'link', name, href });
const category = (g: ReturnType<typeof gateClick>) => (g.kind === 'approve' ? g.category : 'allow');

describe('approval gate: irreversible actions stop', () => {
  it('pays, books and buys', () => {
    expect(category(gateClick(button('Continue to payment', { form: post() }), roam))).toBe('pay');
    expect(category(gateClick(button('Pay $186.00 and book', { form: post() }), roam))).toBe('pay');
    expect(category(gateClick(button('Checkout'), roam))).toBe('pay');
    expect(category(gateClick(button('Place order'), roam))).toBe('pay');
    expect(category(gateClick(button('Book now'), roam))).toBe('book');
    expect(category(gateClick(button('Reserve'), roam))).toBe('book');
    expect(category(gateClick(button('Buy now'), roam))).toBe('buy');
    expect(category(gateClick(button('Subscribe'), roam))).toBe('buy');
  });

  it('sends, posts and deletes', () => {
    expect(category(gateClick(button('Send', { form: post() }), roam))).toBe('send');
    expect(category(gateClick(button('Send invitation'), roam))).toBe('send');
    expect(category(gateClick(button('Post'), roam))).toBe('post');
    expect(category(gateClick(button('Publish'), roam))).toBe('post');
    expect(category(gateClick(button('Delete'), roam))).toBe('delete');
    expect(category(gateClick(button('Remove item'), roam))).toBe('delete');
    expect(category(gateClick(button('Cancel my subscription'), roam))).toBe('delete');
    expect(category(gateClick(link('Delete this bill'), roam))).toBe('delete');
  });

  it('accepting terms and changing settings', () => {
    expect(category(gateClick(button('I agree'), roam))).toBe('accept-terms');
    expect(category(gateClick(button('Accept all cookies'), roam))).toBe('accept-terms');
    expect(category(gateClick(button('Save changes'), roam))).toBe('settings');
    expect(category(gateClick(button('Change password'), roam))).toBe('settings');
    const settingsPage = { url: 'http://localhost:4401/settings', title: 'Settings' };
    expect(category(gateClick(button('Save', { form: post() }), settingsPage))).toBe('settings');
  });

  it('any other POST form submission is a submit', () => {
    expect(category(gateClick(button('Save bill', { form: post() }), ledgerly))).toBe('submit');
    expect(category(gateClick(button('Save draft', { form: post() }), ledgerly))).toBe('submit');
    expect(category(gateClick({ tag: 'input', role: 'button', name: 'Go ahead', type: 'submit', form: post() }, ledgerly))).toBe('submit');
  });

  it('Enter in a field submits its form and is gated the same way', () => {
    const field: TargetFacts = { tag: 'input', role: 'textbox', name: 'Amount', form: post('Save bill') };
    expect(category(gateEnter(field, ledgerly))).toBe('submit');
    expect(category(gateEnter({ ...field, form: post('Pay now') }, roam))).toBe('pay');
    expect(category(gateEnter({ ...field, form: get('Search') }, roam))).toBe('allow');
    expect(category(gateEnter({ tag: 'input', role: 'textbox', name: 'Search' }, roam))).toBe('allow');
  });

  it('the summary names the button and the site', () => {
    const g = gateClick(button('Pay $186.00 and book', { form: post() }), roam);
    expect(g).toEqual({ kind: 'approve', category: 'pay', summary: 'Pay: “Pay $186.00 and book” on localhost:4402' });
  });
});

describe('approval gate: ordinary browsing flows', () => {
  it('allows navigation, search and reading', () => {
    for (const t of [
      link('Select'),
      link('Reply'),
      link('Forward'),
      link('+ New bill'),
      link('Settings'),
      link('Next ›'),
      button('Search flights', { form: get() }),
      button('Search hotels', { form: get() }),
      button('Sign in', { form: post() }),
      button('Show more'),
      button('Cheapest'),
      { tag: 'input', role: 'textbox', name: 'Vendor', form: post() },
      { tag: 'select', role: 'combobox', name: 'Category', form: post() },
      { tag: 'button', role: 'button', name: 'Toggle menu', type: 'button', form: post() },
    ] as TargetFacts[])
      expect(category(gateClick(t, ledgerly)), t.name).toBe('allow');
  });
});

describe('pre-approval', () => {
  it('covers only the named categories on the named hosts', () => {
    const pre = { categories: ['submit' as const], hosts: ['localhost:4401'] };
    const save = gateClick(button('Save bill', { form: post() }), ledgerly);
    expect(isPreApproved(save, ledgerly, pre)).toBe(true);
    expect(isPreApproved(save, { ...ledgerly, url: 'http://localhost:4400/compose' }, pre)).toBe(false);
    const send = gateClick(button('Send', { form: post() }), ledgerly);
    expect(isPreApproved(send, ledgerly, pre)).toBe(false);
    expect(isPreApproved({ kind: 'allow' }, ledgerly, pre)).toBe(false);
    expect(isPreApproved(save, ledgerly, undefined)).toBe(false);
  });
});

describe('approving by voice', () => {
  it('hears yes and no', () => {
    for (const t of ['Yes.', 'yes, book it', 'Yeah go ahead', 'OK', 'approve', 'Sure, send it.', 'Do it'])
      expect(voiceAnswer(t), t).toBe('approved');
    for (const t of ['No.', "No, don't", 'Stop', 'Cancel that', 'wait', 'Hold on', 'yes— no wait'])
      expect(voiceAnswer(t), t).toBe('declined');
    for (const t of ['', 'what is this?', 'find a cheaper one']) expect(voiceAnswer(t), t).toBeNull();
  });
});
