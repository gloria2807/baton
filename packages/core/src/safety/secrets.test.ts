import { describe, expect, it } from 'vitest';
import { redactSecrets } from './secrets.js';

describe('redactSecrets', () => {
  it('masks passwords, codes and card numbers in a goal', () => {
    expect(
      redactSecrets('Sign in to Ledgerly with the work email ama@harbourline.example and the password Lagos2026!'),
    ).toBe('Sign in to Ledgerly with the work email ama@harbourline.example and the password •••');
    expect(redactSecrets('my password is "hunter 2"')).toContain('password is "•••"');
    expect(redactSecrets('PIN: 4821, then continue')).toBe('PIN: •••, then continue');
    expect(redactSecrets('the one-time code 993812')).toBe('the one-time code •••');
    expect(redactSecrets('pay with 4111 1111 1111 1111 please')).toBe('pay with •••• card number •••• please');
  });

  it('leaves ordinary goals alone', () => {
    for (const t of [
      'Book Hotel Ribeira Azul for December 1 to 4, 2026',
      'Reset my password on the settings page',
      'Enter invoice INV-2300 for $1,234.56',
      'Call me on 0803 123 4567',
    ])
      expect(redactSecrets(t), t).toBe(t);
  });
});
