import { addDays, shortDayLabel, startOfWeek, toIsoDate, weekDates, weekdayIndex } from './dates';

describe('dates', () => {
  it('formats the local calendar day', () => {
    expect(toIsoDate(new Date(2026, 9, 20, 23, 59))).toBe('2026-10-20');
  });

  it('adds days across month ends and DST changes', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30'); // EU DST start
    expect(addDays('2026-10-24', 7)).toBe('2026-10-31');
  });

  it('finds the Monday of the week', () => {
    expect(weekdayIndex('2026-10-19')).toBe(0);
    expect(startOfWeek('2026-10-25')).toBe('2026-10-19');
    expect(startOfWeek('2026-10-19')).toBe('2026-10-19');
    expect(weekDates('2026-10-19')).toHaveLength(7);
    expect(shortDayLabel('2026-10-20')).toBe('Tue 20');
  });
});
