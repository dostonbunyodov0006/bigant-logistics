jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
import { startSlotKey } from '../lib/format';
import { isOrderActionLocked } from '../hooks/useOrderActivationClock';
import { pickCurrent } from '../screens/tabs/CurrentOrdersTab';
import { order } from './fixtures';

describe('Ertangi slot instead of a clock time', () => {
  it('a dated Ertangi order reads 9:00 dan oldin / keyin, not 05:00', () => {
    expect(startSlotKey(order({ actions_available_at: '2026-10-28T19:01:00.000Z' }))).toBe('orders.before9');
    expect(startSlotKey(order({ actions_available_at: '2026-10-29T04:00:00.000Z', start_after_nine: true }))).toBe('orders.after9');
  });
  it('an order with a real time keeps its time', () => {
    expect(startSlotKey(order())).toBeNull();
  });
});

describe('locked until its opening', () => {
  const at = Date.parse('2026-10-29T04:00:00.000Z');
  it('locked before, open from the opening on', () => {
    const o = order({ actions_available_at: '2026-10-29T04:00:00.000Z' });
    expect(isOrderActionLocked(o, at - 1)).toBe(true);
    expect(isOrderActionLocked(o, at)).toBe(false);
  });
  it('an order with no opening time is never locked', () => {
    expect(isOrderActionLocked(order(), at)).toBe(false);
  });
});

describe('which order is the current one', () => {
  it('the one under way comes before an accepted one', () => {
    const waiting = order({ id: 'a', status: 'driver_accepted' });
    const running = order({ id: 'b', status: 'on_the_way', next_action: { type: 'arrive_customer' } as never });
    expect(pickCurrent([waiting, running])[0]!.id).toBe('b');
  });
  it('a return set aside with Ojidaniya lets the next order come up', () => {
    const deferred = order({ id: 'r', status: 'returning', return_deferred_at: '2026-10-29T05:00:00.000Z', next_action: { type: 'return_depart' } as never });
    const next = order({ id: 'n', status: 'driver_accepted' });
    expect(pickCurrent([deferred, next])[0]!.id).toBe('n');
  });
  it('a po puti on the 2nd order: once the host waits for it, the co-load comes up, not the 3rd order (owner, 10.11.2026)', () => {
    const host = order({ id: 'h', order_number: 2, status: 'collecting_items', delivery_trip_position: 3, next_action: { type: 'waiting_for_trip_stop' } as never });
    const third = order({ id: 't', order_number: 3, status: 'driver_accepted' });
    const coload = order({ id: 'c', order_number: 9, status: 'driver_accepted', delivery_trip_position: 4 });
    expect(pickCurrent([host, third, coload])[0]!.id).toBe('c');
  });
});
