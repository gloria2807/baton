// Passwords and codes a person says or writes in a goal are never needed by a lane (it cannot type
// them, rule 2), so they are masked before the model, receipts or logs ever see the goal.

const SECRET =
  /\b(password|passcode|passphrase|pin|one[- ]time code|otp|security code|cvc|cvv)(\s*(?:is|was|=|:)\s*|\s+)("[^"]*"|“[^”]*”|'[^']*'|\S+)/gi;
const CARD = /\b\d(?:[ -]?\d){12,18}\b/g;

export function redactSecrets(text: string): string {
  return text
    .replace(SECRET, (whole: string, word: string, gap: string, value: string) => {
      const quoted = /^["“']/.test(value);
      const trail = quoted ? '' : (value.match(/[,;.]+$/)?.[0] ?? '');
      const bare = value.slice(0, value.length - trail.length);
      // "the password on the settings page" is not a secret; "password Lagos2026!", "password: x" and "password "x"" are.
      const named = /\b(is|was)\b|[=:]/.test(gap);
      if (!quoted && !named && !/[\d\W_]/.test(bare)) return whole;
      return `${word}${gap}${quoted ? `${value[0]}•••${value.at(-1)}` : '•••'}${trail}`;
    })
    .replace(CARD, '•••• card number ••••');
}
