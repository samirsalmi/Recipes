import { ActivityEvent } from '../../models';
import { groupActivity, timeAgo } from './household.component';

function ev(id: number, type: string, userId: number, key = ''): ActivityEvent {
  return { id, type, userId, userName: userId === 1 ? 'Amina' : 'Alex', payload: { key, summary: `got ${key}` }, createdAt: '2026-10-20T10:00:00+00:00' };
}

describe('household activity feed', () => {
  it('collapses consecutive check-offs by the same member', () => {
    const grouped = groupActivity([ev(5, 'groceries.mark', 1, 'rice'), ev(4, 'groceries.mark', 1, 'milk'), ev(3, 'groceries.mark', 1, 'eggs'), ev(2, 'plan.add', 1), ev(1, 'groceries.mark', 2, 'salt')]);
    expect(grouped.map(e => e.id)).toEqual([5, 2, 1]);
    expect(grouped[0].payload.summary).toBe('got rice, milk and 1 more');
    expect(grouped[2].payload.summary).toBe('got salt');
  });

  it('formats relative times', () => {
    const now = Date.parse('2026-10-20T12:00:00Z');
    expect(timeAgo('2026-10-20T11:59:40Z', now)).toBe('just now');
    expect(timeAgo('2026-10-20T11:45:00Z', now)).toBe('15 min ago');
    expect(timeAgo('2026-10-19T11:00:00Z', now)).toBe('yesterday');
  });
});
