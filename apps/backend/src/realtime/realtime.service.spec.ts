import { canSeeRealtimeEvent } from './realtime.service';
import type { RealtimeEvent } from '@bigant/shared';

const evt = (over: Partial<RealtimeEvent>): RealtimeEvent => ({
  type: 'order_status_changed',
  order_id: 'o1',
  driver_id: 'drvA',
  status: 'delivered',
  at: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('canSeeRealtimeEvent', () => {
  it('lets admin/manager/seller see every board event', () => {
    for (const role of ['admin', 'manager', 'seller'] as const) {
      expect(canSeeRealtimeEvent(role, null, evt({}))).toBe(true);
      expect(canSeeRealtimeEvent(role, null, evt({ type: 'driver_status_changed' }))).toBe(true);
    }
  });

  it('only lets a driver see their own events', () => {
    expect(canSeeRealtimeEvent('driver', 'drvA', evt({ driver_id: 'drvA' }))).toBe(true);
    expect(canSeeRealtimeEvent('driver', 'drvA', evt({ driver_id: 'drvB' }))).toBe(false);
    // A driver with no resolved id sees nothing.
    expect(canSeeRealtimeEvent('driver', null, evt({ driver_id: 'drvA' }))).toBe(false);
  });

  it('always passes pings', () => {
    expect(canSeeRealtimeEvent('driver', null, evt({ type: 'ping', driver_id: null }))).toBe(true);
  });
});
