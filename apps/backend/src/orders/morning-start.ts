import type { PrismaClient } from '@prisma/client';
import { driverActionsAvailableAt, type TimedOrder } from './order-timing';
import { shiftStartUtcMs } from '../common/shift-clock';
import { isPayDayLocked } from '../payroll/period-lock';

/**
 * The morning early start (Ertalab erta boshlash).
 *
 * The working day is 09:00–18:00. An Ertangi order the seller booked for
 * "9:00 dan oldin" opens at 00:01, and the driver may set off on it early.
 * His first "yo'lga chiqdim" of that morning on such an order — to a pickup,
 * a supplier, the client, or a return's drop-off — is written down here with
 * where his phone was. MorningStartService then confirms it from the GPS
 * trail: the start is the moment the lorry is seen 300 m off, before 09:00,
 * and the minutes from then to nine are what the early-start bonus is paid on. Not moved by
 * nine, there is nothing: from 09:00 it is the ordinary working day.
 */

/** A fix older than this says where the phone was, not where it is. */
const PRESS_FIX_FRESH_MS = 5 * 60 * 1000;

export type MorningAction = 'pickup' | 'customer' | 'return';

type PressOrder = TimedOrder & { id: string };
type PressDriver = {
  id: string;
  locationLat: number | null;
  locationLng: number | null;
  locationUpdatedAt: Date | null;
};

/** The day's 09:00 for an order booked for before nine, or null when it does not count. */
export function morningNineFor(order: TimedOrder): Date | null {
  if (order.startAfterNine) return null;
  if (driverActionsAvailableAt(order) === null) return null;
  return new Date(order.deliveryDatetime.getTime() + shiftStartUtcMs());
}

/**
 * Note a "yo'lga chiqdim" press before 09:00. The first of the day is the one
 * watched; a later press that morning is noted only if that one came to nothing.
 */
export async function recordMorningPress(
  prisma: Pick<PrismaClient, 'morningStart'>,
  order: PressOrder,
  driver: PressDriver,
  action: MorningAction,
  now: Date,
): Promise<void> {
  const nine = morningNineFor(order);
  if (!nine || now.getTime() >= nine.getTime()) return;
  // Never for a day in a paid, locked period (owner, 07.11.2026).
  if (isPayDayLocked(order.deliveryDatetime, now)) return;

  const fresh =
    driver.locationLat != null &&
    driver.locationLng != null &&
    !!driver.locationUpdatedAt &&
    now.getTime() - driver.locationUpdatedAt.getTime() <= PRESS_FIX_FRESH_MS;
  const press = {
    orderId: order.id,
    action,
    pressedAt: now,
    pressLat: fresh ? driver.locationLat : null,
    pressLng: fresh ? driver.locationLng : null,
    status: 'waiting_gps',
    startedAt: null,
    movedAt: null,
    earlyMinutes: 0,
  };
  const day = order.deliveryDatetime;
  const existing = await prisma.morningStart.findUnique({
    where: { driverId_day: { driverId: driver.id, day } },
    select: { id: true, status: true },
  });
  if (!existing) {
    await prisma.morningStart.create({ data: { driverId: driver.id, day, ...press } });
  } else if (existing.status === 'no_move') {
    await prisma.morningStart.update({ where: { id: existing.id }, data: press });
  }
}
