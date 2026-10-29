// Pairing between the desktop app and the extension: the app shows a token once, the person pastes
// it into the extension's options page, and every bridge connection must present it.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// 32 random bytes → 43 url-safe characters (256 bits).
export function newPairingToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = i + 2 < bytes.length ? 4 : i + 1 < bytes.length ? 3 : 2;
    for (let c = 0; c < chars; c++) out += ALPHABET[(n >> (18 - 6 * c)) & 63];
  }
  return out;
}

export function isWellFormedToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

// Compare in time that does not depend on where the strings first differ.
export function tokensMatch(expected: string, given: string): boolean {
  if (!isWellFormedToken(expected) || typeof given !== 'string') return false;
  let diff = expected.length ^ given.length;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ (given.charCodeAt(i) || 0);
  return diff === 0;
}

// Only connections from the extension (or none, for local test clients) may pair.
export function isAllowedOrigin(origin: string | undefined, extensionIds: string[] = []): boolean {
  if (!origin) return true;
  const m = origin.match(/^chrome-extension:\/\/([a-p]{32})$/);
  if (!m) return false;
  return extensionIds.length === 0 || extensionIds.includes(m[1]!);
}
