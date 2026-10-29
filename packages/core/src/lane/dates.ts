// Date fields: models write dates many ways, <input type="date"> holds YYYY-MM-DD.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');

function valid(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}

// "2026-11-20", "11/20/2026", "20 November 2026", "Nov 20, 2026" → "2026-11-20". US order for slashes.
export function toIsoDate(text: string): string | null {
  const t = text.trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1');
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return valid(+m[1]!, +m[2]!, +m[3]!);
  m = t.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (m) return valid(+m[3]!, +m[1]!, +m[2]!);
  m = t.match(/^([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m && MONTHS.includes(m[1]!)) return valid(+m[3]!, MONTHS.indexOf(m[1]!) + 1, +m[2]!);
  m = t.match(/^(\d{1,2})\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})$/);
  if (m && MONTHS.includes(m[2]!)) return valid(+m[3]!, MONTHS.indexOf(m[2]!) + 1, +m[1]!);
  return null;
}

export const DATE_INPUT_TYPES = ['date'];
