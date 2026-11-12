jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
import { dmy, groupDays } from '../screens/tabs/TodayOrdersTab';
import { order } from './fixtures';

// The Bugungi tab folds the finished work by day (owner, 03.11.2026): today's
// queue stays a queue, every day is one group, newest first.
const at = (day: string, h: number) => `${day}T${String(h).padStart(2, '0')}:00:00`;

describe('groupDays', () => {
  const today = '2026-11-03';
  const orders = [
    order({ id: 'q1', status: 'assigned_to_driver', delivery_datetime: at(today, 14), queue_position: 2, created_at: at(today, 8) }),
    order({ id: 'q2', status: 'assigned_to_driver', delivery_datetime: at(today, 15), queue_position: 1, created_at: at(today, 9) }),
    order({ id: 'd1', status: 'delivered', delivery_datetime: at(today, 10), created_at: at(today, 7) }),
    order({ id: 'c1', status: 'cancelled', delivery_datetime: at(today, 11), created_at: at(today, 7) }),
    order({ id: 'y1', status: 'delivered', delivery_datetime: at('2026-11-02', 10), created_at: at('2026-11-02', 7) }),
    order({ id: 'y2', status: 'returned', delivery_datetime: at('2026-11-02', 12), created_at: at('2026-11-02', 8) }),
    order({ id: 'o1', status: 'delivered', delivery_datetime: at('2026-10-30', 12), created_at: at('2026-10-30', 8) }),
    // A booking left unfinished on a past day still sits under that day.
    order({ id: 'o2', status: 'assigned_to_driver', delivery_datetime: at('2026-10-30', 13), created_at: at('2026-10-30', 9) }),
  ];

  it("today's queue is in driving order and holds only today's open orders", () => {
    const { queue } = groupDays(orders, today);
    expect(queue.map((o) => o.id)).toEqual(['q2', 'q1']);
  });

  it('one group per day, today first, finished newest first, cancelled apart', () => {
    const { days } = groupDays(orders, today);
    expect(days.map((d) => d.day)).toEqual(['2026-11-03', '2026-11-02', '2026-10-30']);
    expect(days[0].done.map((o) => o.id)).toEqual(['d1']);
    expect(days[0].cancelled.map((o) => o.id)).toEqual(['c1']);
    expect(days[1].done.map((o) => o.id)).toEqual(['y2', 'y1']);
    expect(days[2].done.map((o) => o.id)).toEqual(['o2', 'o1']);
  });

  it('writes the day the way the office does', () => {
    expect(dmy('2026-11-02')).toBe('02.11.2026');
  });
});
