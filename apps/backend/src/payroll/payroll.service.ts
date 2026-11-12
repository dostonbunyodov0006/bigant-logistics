import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  PayrollDriverDetail,
  PayrollDriverRow,
  PayrollDrivers,
  PayrollEntry,
  PayrollFilterInput,
} from '@bigant/shared';
import { PrismaService } from '../prisma/prisma.service';
import { tashkentDayStartUtc } from '../common/tashkent-time';
import { shiftStartUtcMs } from '../common/shift-clock';
import { buildBonusWorkbook, type Category, type XlsxOvertimeDay, type XlsxTrip } from './payroll-excel';

const MS_PER_DAY = 86_400_000;

/** A YYYY-MM-DD calendar day as its start in Tashkent, as a UTC instant. */
function toDate(s: string): Date {
  return tashkentDayStartUtc(s);
}

@Injectable()
export class PayrollService {
  constructor(private readonly prisma: PrismaService) {}

  /** The [from, to] days as an instant range; `to` covers its whole day. */
  private range(filters: PayrollFilterInput): { gte: Date; lt: Date } {
    return { gte: toDate(filters.from), lt: new Date(toDate(filters.to).getTime() + MS_PER_DAY) };
  }

  /**
   * Ish haqi: every driver with his three bonuses for the period — pickups,
   * deliveries, and the minutes before 09:00 and after 18:00 (owner, 29.10.2026).
   * Read from the same rows as the driver's own earnings screen.
   */
  async listDrivers(filters: PayrollFilterInput): Promise<PayrollDrivers> {
    const at = this.range(filters);
    const [drivers, tariffGroups, earlyGroups, eveningGroups] = await Promise.all([
      this.prisma.driver.findMany({
        include: {
          user: { select: { name: true, status: true } },
          vehicle: { select: { plateNumber: true, model: true } },
        },
      }),
      this.prisma.driverTariffEarning.groupBy({
        by: ['driverId', 'type'],
        where: { earnedAt: at },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.morningStart.groupBy({
        by: ['driverId'],
        where: { status: 'confirmed', earlyMinutes: { gt: 0 }, pressedAt: at },
        _sum: { amountSom: true, earlyMinutes: true },
      }),
      this.prisma.eveningOvertime.groupBy({
        by: ['driverId'],
        where: { lastPhotoAt: at },
        _sum: { amountSom: true, minutes: true },
      }),
    ]);
    const rows = new Map<string, PayrollDriverRow>();
    for (const d of drivers) {
      rows.set(d.id, {
        driver_id: d.id,
        driver_name: d.user?.name ?? null,
        vehicle: d.vehicle ? `${d.vehicle.plateNumber} · ${d.vehicle.model}` : null,
        plate_number: d.vehicle?.plateNumber ?? null,
        vehicle_model: d.vehicle?.model ?? null,
        pickup_total: 0,
        pickup_count: 0,
        delivery_total: 0,
        delivery_count: 0,
        overtime_total: 0,
        overtime_minutes: 0,
        total: 0,
      });
    }
    for (const g of tariffGroups) {
      const r = rows.get(g.driverId);
      if (!r) continue;
      if (g.type.startsWith('pickup')) {
        r.pickup_total += g._sum.amount ?? 0;
        r.pickup_count += g._count._all;
      } else {
        r.delivery_total += g._sum.amount ?? 0;
        r.delivery_count += g._count._all;
      }
    }
    for (const g of earlyGroups) {
      const r = rows.get(g.driverId);
      if (!r) continue;
      r.overtime_total += g._sum.amountSom ?? 0;
      r.overtime_minutes += g._sum.earlyMinutes ?? 0;
    }
    for (const g of eveningGroups) {
      const r = rows.get(g.driverId);
      if (!r) continue;
      r.overtime_total += g._sum.amountSom ?? 0;
      r.overtime_minutes += g._sum.minutes ?? 0;
    }
    const active = new Set(drivers.filter((d) => d.user?.status === 'active').map((d) => d.id));
    const out = [...rows.values()]
      .map((r) => ({ ...r, total: r.pickup_total + r.delivery_total + r.overtime_total }))
      // A driver let go still shows for a period he earned in.
      .filter((r) => active.has(r.driver_id) || r.total > 0)
      .sort((a, b) => b.total - a.total || (a.driver_name ?? '').localeCompare(b.driver_name ?? ''));
    return { rows: out };
  }

  /** The bonus workbook for the period, laid out as the mini app's (payroll-excel.ts). */
  async exportXlsx(
    filters: PayrollFilterInput,
    driverId?: string,
  ): Promise<{ filename: string; base64: string }> {
    const at = this.range(filters);
    const one = driverId ? { driverId } : {};
    const driverInclude = {
      driver: {
        select: { user: { select: { name: true } }, vehicle: { select: { category: true } } },
      },
    } as const;
    const [earnings, mornings, evenings] = await Promise.all([
      this.prisma.driverTariffEarning.findMany({
        where: { ...one, earnedAt: at },
        include: {
          ...driverInclude,
          order: { select: { clientName: true, proofPhotoUrl: true } },
          pickupSource: { select: { name: true, loadPhotoUrl: true } },
        },
      }),
      this.prisma.morningStart.findMany({
        where: { ...one, status: 'confirmed', earlyMinutes: { gt: 0 }, pressedAt: at },
        include: driverInclude,
      }),
      this.prisma.eveningOvertime.findMany({ where: { ...one, lastPhotoAt: at }, include: driverInclude }),
    ]);
    const nameOf = (d: { user: { name: string } | null } | null) => d?.user?.name ?? '—';
    const catOf = (d: { vehicle: { category: string | null } | null } | null) =>
      (d?.vehicle?.category ?? null) as Category;
    const trips = (pickup: boolean): XlsxTrip[] =>
      earnings
        .filter((e) => e.type.startsWith('pickup') === pickup)
        .map((e) => ({
          driver: nameOf(e.driver),
          category: catOf(e.driver),
          at: e.earnedAt,
          outside: e.type.endsWith('outside'),
          amount: e.amount,
          photo: pickup ? !!e.pickupSource?.loadPhotoUrl : !!e.order?.proofPhotoUrl,
          note: pickup ? (e.pickupSource?.name ?? e.order?.clientName ?? null) : (e.order?.clientName ?? null),
        }));

    // A morning and an evening of the same day are one row, as on the mini app's sheet.
    const days = new Map<string, XlsxOvertimeDay>();
    const dayOf = (driverId: string, name: string, category: Category, day: string, rate: number) => {
      const key = `${driverId}|${day}`;
      const row = days.get(key) ?? {
        driver: name,
        category,
        day,
        rate,
        started: null,
        finished: null,
        minutes: 0,
        amount: 0,
        morning: false,
        evening: false,
        border: false,
      };
      days.set(key, row);
      return row;
    };
    const tk = (d: Date) => new Date(d.getTime() + 5 * 3_600_000).toISOString();
    for (const m of mornings) {
      const row = dayOf(m.driverId, nameOf(m.driver), catOf(m.driver), m.day.toISOString().slice(0, 10), m.rateHourSom);
      row.started = tk(m.startedAt ?? m.pressedAt).slice(11, 16);
      row.minutes += m.earlyMinutes;
      row.amount += m.amountSom;
      row.morning = true;
    }
    for (const e of evenings) {
      const row = dayOf(e.driverId, nameOf(e.driver), catOf(e.driver), tk(e.dayEndAt).slice(0, 10), e.rateHourSom);
      row.finished = tk(e.borderAt ?? e.lastPhotoAt).slice(11, 16);
      row.border = !!e.borderAt;
      row.minutes += e.minutes;
      row.amount += e.amountSom;
      row.evening = true;
    }

    const person = driverId
      ? ((await this.prisma.driver.findUnique({ where: { id: driverId }, select: { user: { select: { name: true } } } }))
          ?.user?.name ?? null)
      : null;
    if (driverId && !person) throw new NotFoundException('driver_not_found');
    const buf = await buildBonusWorkbook({
      personal: person ?? undefined,
      from: filters.from,
      to: filters.to,
      today: tk(new Date()).slice(0, 10),
      pickups: trips(true),
      deliveries: trips(false),
      overtime: [...days.values()],
    });
    const dmy = (s: string) => s.split('-').reverse().join('_');
    return {
      filename: person
        ? `${person}_шахсий_${dmy(filters.from)}_${dmy(filters.to)}.xlsx`
        : `Бонус_${dmy(filters.from)}_${dmy(filters.to)}.xlsx`,
      base64: buf.toString('base64'),
    };
  }

  /** One driver's bonuses for the period, each with its day, time, place and price. */
  async driverDetail(driverId: string, filters: PayrollFilterInput): Promise<PayrollDriverDetail> {
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      include: {
        user: { select: { name: true } },
        vehicle: { select: { plateNumber: true, model: true, category: true } },
      },
    });
    if (!driver) throw new NotFoundException('driver_not_found');
    const at = this.range(filters);
    const [earnings, mornings, evenings, tariff] = await Promise.all([
      this.prisma.driverTariffEarning.findMany({
        where: { driverId, earnedAt: at },
        include: { order: { select: { clientName: true } }, pickupSource: { select: { name: true } } },
        orderBy: { earnedAt: 'asc' },
      }),
      this.prisma.morningStart.findMany({
        where: { driverId, status: 'confirmed', earlyMinutes: { gt: 0 }, pressedAt: at },
        orderBy: { pressedAt: 'asc' },
      }),
      this.prisma.eveningOvertime.findMany({ where: { driverId, lastPhotoAt: at }, orderBy: { lastPhotoAt: 'asc' } }),
      driver.vehicle?.category
        ? this.prisma.vehicleTariff.findUnique({ where: { category: driver.vehicle.category } })
        : Promise.resolve(null),
    ]);
    // What the tariff sets today, beside what was paid at the time.
    const perTrip: Record<string, number | undefined> = {
      pickup_city: tariff?.pickupCitySom,
      pickup_outside: tariff?.pickupOutsideSom,
      delivery_city: tariff?.deliveryCitySom,
      delivery_outside: tariff?.deliveryOutsideSom,
    };
    const trip = (e: (typeof earnings)[number]): PayrollEntry => ({
      id: e.id,
      kind: e.type,
      at: e.earnedAt.toISOString(),
      place: e.type.startsWith('pickup')
        ? (e.pickupSource?.name ?? e.order?.clientName ?? null)
        : (e.order?.clientName ?? null),
      started_at: null,
      ended_at: null,
      minutes: null,
      tariff_som: perTrip[e.type] ?? null,
      amount_som: e.amount,
    });
    const overtime: PayrollEntry[] = [
      ...mornings.map((m) => ({
        id: m.id,
        kind: 'early' as const,
        at: m.pressedAt.toISOString(),
        place: null,
        started_at: (m.startedAt ?? m.pressedAt).toISOString(),
        // 09:00 in Tashkent on that day.
        ended_at: new Date(m.day.getTime() + shiftStartUtcMs()).toISOString(),
        minutes: m.earlyMinutes,
        tariff_som: m.rateHourSom,
        amount_som: m.amountSom,
      })),
      ...evenings.map((e) => ({
        id: e.id,
        kind: 'evening' as const,
        at: e.lastPhotoAt.toISOString(),
        place: e.borderAt ? 'Toshkent chegarasi' : null,
        started_at: e.dayEndAt.toISOString(),
        ended_at: (e.borderAt ?? e.lastPhotoAt).toISOString(),
        minutes: e.minutes,
        tariff_som: e.rateHourSom,
        amount_som: e.amountSom,
      })),
    ].sort((a, b) => a.at.localeCompare(b.at));
    return {
      driver_id: driver.id,
      driver_name: driver.user?.name ?? null,
      vehicle: driver.vehicle ? `${driver.vehicle.plateNumber} · ${driver.vehicle.model}` : null,
      pickups: earnings.filter((e) => e.type.startsWith('pickup')).map(trip),
      deliveries: earnings.filter((e) => e.type.startsWith('delivery')).map(trip),
      overtime,
    };
  }
}
