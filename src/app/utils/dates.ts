// Plain local calendar dates as "YYYY-MM-DD" strings, end to end (plan entries, shopping
// trips). Never use toISOString() for these: it converts to UTC and can shift the day near
// midnight (old gotcha G5). Day arithmetic goes through UTC noon so DST changes can't skip
// or repeat a day.

/** Today's local date. */
export function todayIso(now: Date = new Date()): string {
  return toIsoDate(now);
}

/** A Date's *local* calendar day as YYYY-MM-DD. */
export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toUtcNoon(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

function fromUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function addDays(iso: string, days: number): string {
  const d = toUtcNoon(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

/** 0 = Monday ... 6 = Sunday. */
export function weekdayIndex(iso: string): number {
  return (toUtcNoon(iso).getUTCDay() + 6) % 7;
}

/** The Monday of the plan week containing `iso`. */
export function startOfWeek(iso: string): string {
  return addDays(iso, -weekdayIndex(iso));
}

export function weekDates(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** "Mon 20" style label (English, short). */
export function shortDayLabel(iso: string): string {
  const d = toUtcNoon(iso);
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })} ${d.getUTCDate()}`;
}
