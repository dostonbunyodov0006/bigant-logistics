import type { Order } from '@prisma/client';
import { shiftStartUtcMs } from '../common/shift-clock';

/**
 * When a driver may start working an order.
 *
 * Seller-board future bookings (Ertangi) store their scheduled calendar day as
 * a UTC-midnight label, and open to the driver at 00:01 Tashkent that day —
 * 19:01 UTC the evening before (owner, 28.10.2026: was 03:00). Everything else is workable the moment it is
 * his.
 *
 * Kept apart from OrdersService because the driver's status, his shift and his
 * next assignment all need the same answer: an order he cannot touch yet is
 * not work he is doing.
 */
const TASHKENT_ACTION_START_UTC_OFFSET_MS = (5 * 60 - 1) * 60 * 1000;

export type TimedOrder = Pick<Order, 'bookingKind' | 'deliveryDatetime'> & { startAfterNine?: boolean | null };

/** The instant the driver may act on it, or null when he already may. */
export function driverActionsAvailableAt(order: TimedOrder): Date | null {
  const scheduledDay = order.deliveryDatetime;
  const isFutureSellerBooking =
    order.bookingKind !== null &&
    scheduledDay.getUTCHours() === 0 &&
    scheduledDay.getUTCMinutes() === 0 &&
    scheduledDay.getUTCSeconds() === 0 &&
    scheduledDay.getUTCMilliseconds() === 0;

  if (!isFutureSellerBooking) return null;
  // Booked for after 09:00: seen in the morning, workable from nine.
  return order.startAfterNine
    ? new Date(scheduledDay.getTime() + shiftStartUtcMs())
    : new Date(scheduledDay.getTime() - TASHKENT_ACTION_START_UTC_OFFSET_MS);
}

/** True once the driver may act on the order — today's work, not tomorrow's. */
export function isActionable(order: TimedOrder, now: Date = new Date()): boolean {
  const at = driverActionsAvailableAt(order);
  return !at || now.getTime() >= at.getTime();
}
