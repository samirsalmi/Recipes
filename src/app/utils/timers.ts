// Detects durations in step text ("simmer for 10 minutes", "bake 1½ hours", "8-10 min") so
// cooking mode and the recipe page can offer a tappable timer. Never asked for in the form.

export interface DetectedTimer {
  /** Minutes (upper bound for ranges). */
  minutes: number;
  /** The matched text, e.g. "8-10 minutes". */
  label: string;
}

export type StepPart = { text: string; timer?: DetectedTimer };

const FRACTIONS: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };
const NUM = String.raw`([\d٠-٩]+(?:[.,]\d+)?(?:\s*[½¼¾⅓⅔])?|[½¼¾⅓⅔]|an?|one|two|three|four|five|ten|half an?|une?|deux|trois|quatre|cinq|dix|demi(?:e)?)`;
const WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, 'half a': 0.5, 'half an': 0.5,
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, dix: 10, demi: 0.5, demie: 0.5,
};
// English, French (heure/minute/seconde) and Modern Standard Arabic (ساعة/دقيقة/ثانية and plurals).
const UNIT = String.raw`(hours?|hrs?|h\b|heures?|minutes?|mins?|m\b|seconds?|secondes?|secs?|ساعات|ساعة|دقائق|دقيقة|دقيقتين|ثواني|ثوان|ثانية)`;
const PATTERN = new RegExp(String.raw`(?<![\w])${NUM}(?:\s*(?:-|–|to|à|ou|إلى)\s*${NUM})?\s*${UNIT}`, 'gi');

function toNumber(raw: string): number {
  const t = raw.trim().toLowerCase().replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660));
  if (t in WORDS) return WORDS[t];
  const m = t.match(/^(\d+(?:[.,]\d+)?)?\s*([½¼¾⅓⅔])?$/);
  if (!m) return NaN;
  return (m[1] ? parseFloat(m[1].replace(',', '.')) : 0) + (m[2] ? FRACTIONS[m[2]] : 0);
}

function toMinutes(value: number, unit: string): number {
  const u = unit.toLowerCase();
  if (u.startsWith('h') || u.startsWith('ساع')) return value * 60;
  if (u.startsWith('s') || u.startsWith('ثان') || u.startsWith('ثو')) return value / 60;
  if (u === 'دقيقتين') return value * 2;
  return value;
}

/** Split a step into text and timer parts, in order. Durations under 30 seconds or over
 *  24 hours are ignored (likely not something to time). */
export function splitStepTimers(text: string): StepPart[] {
  const parts: StepPart[] = [];
  let last = 0;
  for (const m of text.matchAll(PATTERN)) {
    const first = toNumber(m[1]);
    const second = m[2] !== undefined ? toNumber(m[2]) : NaN;
    const value = isNaN(second) ? first : Math.max(first, second);
    if (isNaN(value)) continue;
    const minutes = toMinutes(value, m[3]);
    if (minutes < 0.5 || minutes > 24 * 60) continue;
    const start = m.index ?? 0;
    if (start > last) parts.push({ text: text.slice(last, start) });
    parts.push({ text: m[0], timer: { minutes: Math.round(minutes * 10) / 10, label: m[0] } });
    last = start + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

export function detectTimers(text: string): DetectedTimer[] {
  return splitStepTimers(text).flatMap(p => (p.timer ? [p.timer] : []));
}

/** Countdown text: "m:ss" under an hour, "h:mm:ss" above. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}
