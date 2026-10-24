import { detectTimers, formatCountdown, splitStepTimers } from './timers';

describe('step timers', () => {
  it('finds minutes, hours, ranges and fractions', () => {
    expect(detectTimers('Simmer for 10 minutes, stirring.')).toEqual([{ minutes: 10, label: '10 minutes' }]);
    expect(detectTimers('Bake 1½ hours until golden')[0].minutes).toBe(90);
    expect(detectTimers('Cook 8-10 min per side')[0]).toEqual({ minutes: 10, label: '8-10 min' });
    expect(detectTimers('Rest for an hour')[0].minutes).toBe(60);
    expect(detectTimers('Boil 2 to 3 minutes')[0].minutes).toBe(3);
    expect(detectTimers('Whisk 30 seconds')[0].minutes).toBe(0.5);
  });

  it('finds French and Arabic durations too', () => {
    expect(detectTimers('Laisser mijoter 10 minutes à feu doux.')[0].minutes).toBe(10);
    expect(detectTimers('Cuire 1½ heure')[0].minutes).toBe(90);
    expect(detectTimers('Cuire de 8 à 10 min')[0].minutes).toBe(10);
    expect(detectTimers('Reposer une heure')[0].minutes).toBe(60);
    expect(detectTimers('اتركها تغلي 20 دقيقة على نار هادئة')[0].minutes).toBe(20);
    expect(detectTimers('اخبزها ٣٠ دقيقة')[0].minutes).toBe(30);
    expect(detectTimers('انقعها 2 ساعات')[0].minutes).toBe(120);
  });

  it('ignores numbers that are not durations', () => {
    expect(detectTimers('Add 2 eggs and 200 g flour at 180C')).toEqual([]);
    expect(detectTimers('Leave for 10 seconds')).toEqual([]);
  });

  it('splits text around timers in order', () => {
    const parts = splitStepTimers('Fry 5 minutes, then simmer 20 minutes.');
    expect(parts.map(p => p.text)).toEqual(['Fry ', '5 minutes', ', then simmer ', '20 minutes', '.']);
    expect(parts.filter(p => p.timer).map(p => p.timer!.minutes)).toEqual([5, 20]);
  });

  it('formats countdowns', () => {
    expect(formatCountdown(65_000)).toBe('1:05');
    expect(formatCountdown(3_725_000)).toBe('1:02:05');
    expect(formatCountdown(-5)).toBe('0:00');
  });
});
