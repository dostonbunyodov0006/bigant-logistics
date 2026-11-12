import type { Prisma, PrismaClient } from '@prisma/client';
import { BLOCKING_ACTIVE_ORDER_STATUSES, type DriverStatus } from '@bigant/shared';
import { isActionable, type TimedOrder } from '../orders/order-timing';
import { breakTakenMinutes } from './shift-time';

/**
 * A driver's status, worked out from what he is actually carrying.
 *
 * It used to be written by hand at each transition — "delivered, so available"
 * — and each writer had to remember the co-loaded second order, the return
 * riding along, tomorrow's booking that is not work yet, and the driver who
 * has already clocked out. Most remembered; a few did not, and a driver with
 * an order still aboard showed as free. Every transition now asks here.
 *
 * Two rules sit above the orders:
 * - Offline is the shift's to decide. Orders never bring a clocked-out driver
 *   back on; clock-in does, and it asks here for what to come back as.
 * - A pending offer (`assigned_to_driver`) is not work, and neither is a
 *   seller's Ertangi booking before 00:01 on its day, nor a carried return —
 *   a driver taking a return back is free for the next order by design.
 */

type Db = Prisma.TransactionClient | PrismaClient;
type OrderFacts = TimedOrder & { status: string };
export type { OrderFacts };

const ON_THE_ROAD = new Set(['on_the_way', 'arrived_at_customer']);

/** What the orders alone say, for a driver who is on shift. */
export function statusFromOrders(
  orders: readonly OrderFacts[],
  now: Date = new Date(),
): Extract<DriverStatus, 'available' | 'busy' | 'on_delivery'> {
  const working = orders.filter(
    (o) => (BLOCKING_ACTIVE_ORDER_STATUSES as readonly string[]).includes(o.status) && o.status !== 'assigned_to_driver' && isActionable(o, now),
  );
  if (working.some((o) => ON_THE_ROAD.has(o.status))) return 'on_delivery';
  return working.length > 0 ? 'busy' : 'available';
}

/** The driver's orders that are work right now, optionally leaving one out. */
export async function ordersInHand(
  db: Db,
  driverId: string,
  statuses: readonly string[],
  opts: { exceptOrderId?: string; now?: Date } = {},
): Promise<OrderFacts[]> {
  const rows = await db.order.findMany({
    where: {
      assignedDriverId: driverId,
      status: { in: [...statuses] as never },
      ...(opts.exceptOrderId ? { id: { not: opts.exceptOrderId } } : {}),
    },
    select: { status: true, bookingKind: true, deliveryDatetime: true, startAfterNine: true },
  });
  const now = opts.now ?? new Date();
  return rows.filter((o) => isActionable(o, now));
}

/**
 * Bring the stored status in line with the driver's orders and return it.
 * `comingOnShift` is clock-in: the one time an offline driver is re-derived.
 */
export async function settleDriverStatus(
  db: Db,
  driverId: string,
  opts: { comingOnShift?: boolean; now?: Date } = {},
): Promise<{ status: DriverStatus; changed: boolean }> {
  const driver = await db.driver.findUnique({ where: { id: driverId }, select: { currentStatus: true } });
  if (!driver) return { status: 'offline', changed: false };
  const current = driver.currentStatus as DriverStatus;
  if (current === 'offline' && !opts.comingOnShift) return { status: current, changed: false };

  const orders = await db.order.findMany({
    where: { assignedDriverId: driverId, status: { in: [...BLOCKING_ACTIVE_ORDER_STATUSES] } },
    select: { status: true, bookingKind: true, deliveryDatetime: true, startAfterNine: true },
  });
  const next = statusFromOrders(orders, opts.now);
  if (next === current) return { status: current, changed: false };
  await db.driver.update({ where: { id: driverId }, data: { currentStatus: next } });
  return { status: next, changed: true };
}

/**
 * End a break because the driver has started working.
 *
 * A break used to outlive the work that interrupted it: the driver accepted an
 * order and drove off, while `breakUntil` still stood and the seller board
 * showed him resting. The minutes he did take are credited to the open shift,
 * exactly as ending a break by hand does.
 */
export async function closeBreakForWork(db: Db, driverId: string, now: Date = new Date()): Promise<void> {
  const driver = await db.driver.findUnique({
    where: { id: driverId },
    select: { breakStartedAt: true, breakUntil: true },
  });
  if (!driver?.breakStartedAt && !driver?.breakUntil) return;
  const taken = breakTakenMinutes(driver, now);
  if (taken > 0) {
    await db.workLog.updateMany({
      where: { driverId, clockOutAt: null },
      data: { breakMinutes: { increment: taken } },
    });
  }
  await db.driver.update({ where: { id: driverId }, data: { breakUntil: null, breakStartedAt: null } });
  await db.driverBreak.updateMany({ where: { driverId, endedAt: null }, data: { endedAt: now } });
}
