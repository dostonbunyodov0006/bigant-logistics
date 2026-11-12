import { Injectable } from '@nestjs/common';
import type { DriverAnalytics, DriverAnalyticsRow } from '@bigant/shared';
import { PrismaService } from '../prisma/prisma.service';
import { monthRange } from './date-range';

/**
 * A month of every active driver side by side: deliveries, returns, shifts
 * and hours, lateness, fines. Each figure counts by the month the thing
 * happened in (delivered, written up, clocked in, issued), Tashkent time.
 */
@Injectable()
export class DriverAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async month(month: string): Promise<DriverAnalytics> {
    const range = monthRange(month);
    const [drivers, delivered, returnItems, shifts, fines] = await Promise.all([
      // Every driver who could have a figure this month, not only the
      // currently active ones: a driver let go mid-month still worked, and
      // Payroll counts him. Dropping him here made the two pages disagree.
      this.prisma.driver.findMany({
        include: { user: { select: { name: true, status: true } }, vehicle: { select: { plateNumber: true } } },
      }),
      this.prisma.order.groupBy({
        by: ['assignedDriverId'],
        where: { status: 'delivered', deliveredAt: range, assignedDriverId: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.orderReturnItem.findMany({
        where: { createdAt: range },
        select: { orderId: true, order: { select: { assignedDriverId: true } } },
      }),
      this.prisma.workLog.findMany({
        where: { clockInAt: range },
        select: {
          driverId: true,
          clockInAt: true,
          clockOutAt: true,
          breakMinutes: true,
          isLate: true,
          lateMinutes: true,
          isEarlyLeave: true,
        },
      }),
      this.prisma.fine.groupBy({
        by: ['driverId'],
        where: { createdAt: range },
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);

    const rows = new Map<string, DriverAnalyticsRow>(
      drivers.map((d) => [
        d.id,
        {
          driver_id: d.id,
          driver_name: d.user.name,
          driver_active: d.user.status === 'active',
          vehicle_plate: d.vehicle?.plateNumber ?? null,
          delivered: 0,
          returns: 0,
          return_items: 0,
          shifts: 0,
          worked_minutes: 0,
          late: 0,
          late_minutes: 0,
          early_leave: 0,
          fines: 0,
          fines_amount: 0,
        },
      ]),
    );
    const row = (driverId: string | null) => (driverId ? rows.get(driverId) : undefined);

    for (const g of delivered) {
      const r = row(g.assignedDriverId);
      if (r) r.delivered = g._count._all;
    }
    const returnOrders = new Map<string, Set<string>>();
    for (const i of returnItems) {
      const r = row(i.order.assignedDriverId);
      if (!r) continue;
      r.return_items += 1;
      const set = returnOrders.get(r.driver_id) ?? new Set<string>();
      set.add(i.orderId);
      returnOrders.set(r.driver_id, set);
    }
    for (const [driverId, orders] of returnOrders) rows.get(driverId)!.returns = orders.size;
    for (const s of shifts) {
      const r = row(s.driverId);
      if (!r) continue;
      r.shifts += 1;
      if (s.clockOutAt) {
        const minutes = Math.round((s.clockOutAt.getTime() - s.clockInAt.getTime()) / 60_000) - s.breakMinutes;
        r.worked_minutes += Math.max(0, minutes);
      }
      if (s.isLate) {
        r.late += 1;
        r.late_minutes += s.lateMinutes;
      }
      if (s.isEarlyLeave) r.early_leave += 1;
    }
    for (const g of fines) {
      const r = row(g.driverId);
      if (!r) continue;
      r.fines = g._count._all;
      r.fines_amount = g._sum.amount ?? 0;
    }

    // An inactive driver appears only if he did something this month.
    for (const [id, r] of rows) {
      if (!r.driver_active && !hasFigures(r)) rows.delete(id);
    }

    const sorted = [...rows.values()].sort(
      (a, b) => b.delivered - a.delivered || a.driver_name.localeCompare(b.driver_name),
    );
    return { month, rows: sorted, totals: totalsOf(sorted) };
  }
}

/** Did this driver register anything at all in the month? */
function hasFigures(r: DriverAnalyticsRow): boolean {
  return (
    r.delivered > 0 ||
    r.return_items > 0 ||
    r.shifts > 0 ||
    r.fines > 0 ||
    r.fines_amount > 0
  );
}

export function totalsOf(rows: DriverAnalyticsRow[]): DriverAnalytics['totals'] {
  const t = {
    delivered: 0,
    returns: 0,
    return_items: 0,
    shifts: 0,
    worked_minutes: 0,
    late: 0,
    late_minutes: 0,
    early_leave: 0,
    fines: 0,
    fines_amount: 0,
  };
  for (const r of rows) {
    for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += r[k];
  }
  return t;
}
