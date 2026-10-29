import { describe, expect, it } from 'vitest';
import { blockedFieldReason, type FieldFacts } from './fields.js';

const input = (f: Partial<FieldFacts>): FieldFacts => ({ tag: 'input', ...f });

describe('blocked fields', () => {
  it('blocks password inputs by type, autocomplete and wording', () => {
    expect(blockedFieldReason(input({ type: 'password' }))).toBe('password');
    expect(blockedFieldReason(input({ type: 'PASSWORD' }))).toBe('password');
    expect(blockedFieldReason(input({ type: 'text', autocomplete: 'current-password' }))).toBe('password');
    expect(blockedFieldReason(input({ autocomplete: 'section-login new-password' }))).toBe('password');
    expect(blockedFieldReason(input({ name: 'user_passwd' }))).toBe('password');
    expect(blockedFieldReason(input({ label: 'Passcode' }))).toBe('password');
    expect(blockedFieldReason(input({ id: 'pin' }))).toBe('password');
  });

  it('blocks one-time codes', () => {
    expect(blockedFieldReason(input({ autocomplete: 'one-time-code' }))).toBe('one-time-code');
    expect(blockedFieldReason(input({ label: 'One-time code' }))).toBe('one-time-code');
    expect(blockedFieldReason(input({ name: 'otp' }))).toBe('one-time-code');
    expect(blockedFieldReason(input({ label: 'Enter verification code' }))).toBe('one-time-code');
    expect(blockedFieldReason(input({ id: 'mfa-token' }))).toBe('one-time-code');
  });

  it('blocks payment card fields', () => {
    for (const ac of ['cc-number', 'cc-csc', 'cc-exp', 'cc-exp-month', 'cc-name', 'billing cc-number'])
      expect(blockedFieldReason(input({ autocomplete: ac })), ac).toBe('payment-card');
    for (const label of ['Card number', 'CVC', 'CVV', 'Expiry', 'Expiration date', 'MM/YY', 'Credit card', 'IBAN', 'Account number'])
      expect(blockedFieldReason(input({ label })), label).toBe('payment-card');
    expect(blockedFieldReason(input({ name: 'cardnumber' }))).toBe('payment-card');
  });

  it('matches the demo sites exactly', () => {
    // Ledgerly sign-in
    expect(blockedFieldReason(input({ type: 'email', name: 'email', autocomplete: 'username', label: 'Work email' }))).toBeNull();
    expect(blockedFieldReason(input({ type: 'password', name: 'password', autocomplete: 'current-password', label: 'Password' }))).toBe('password');
    expect(blockedFieldReason(input({ name: 'otp', autocomplete: 'one-time-code', label: 'One-time code' }))).toBe('one-time-code');
    // Roam payment
    expect(blockedFieldReason(input({ id: 'cc-number', name: 'cardnumber', autocomplete: 'cc-number', label: 'Card number' }))).toBe('payment-card');
    expect(blockedFieldReason(input({ id: 'cc-csc', name: 'cvc', label: 'Security code' }))).not.toBeNull();
    // Roam traveller details are fine
    expect(blockedFieldReason(input({ id: 'name', name: 'name', autocomplete: 'name', label: 'Full name' }))).toBeNull();
  });

  it('allows ordinary fields Baton needs', () => {
    const ok: Array<Partial<FieldFacts>> = [
      { label: 'Vendor' },
      { label: 'Reference (invoice number)', name: 'reference' },
      { label: 'Amount (USD)', name: 'amount', inputmode: 'decimal' },
      { label: 'Due date', type: 'date' },
      { label: 'Search bills', type: 'search' },
      { label: 'Subject' },
      { label: 'Company name' },
      { label: 'Spinach recipes' }, // "pin" only as a whole word
      { label: 'Notes' },
    ];
    for (const f of ok) expect(blockedFieldReason(input(f)), JSON.stringify(f)).toBeNull();
    expect(blockedFieldReason({ tag: 'textarea', label: 'Message' })).toBeNull();
  });

  it('ignores things that are not editable', () => {
    expect(blockedFieldReason({ tag: 'button', label: 'Password reset' })).toBeNull();
    expect(blockedFieldReason({ tag: 'a', label: 'Forgot password?' })).toBeNull();
  });
});
