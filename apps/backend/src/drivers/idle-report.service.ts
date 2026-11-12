import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { IdleReport, IdleRow, TimesheetFilterInput } from '@bigant/shared';
import { PrismaService } from '../prisma/prisma.service';
import { tashkentDayStartUtc } from '../common/tashkent-time';
import { busyOf, idleByDay, type Busy, type DayTimes, type IdleShift } from './idle-time';

const DAY = 86_400_000;

/**
 * Bo'sh vaqt (owner, 05.11.2026): for each lorry and each driver, how many
 * hours a day the shift stood open with no order in hand. On the site day by
 * day; the month-end Excel gives each one's total.
 */
@Injectable()
export class IdleReportService {
  constructor(private readonly prisma: PrismaService) {}

  async report(filters: TimesheetFilterInput, now = new Date()): Promise<IdleReport> {
    const start = tashkentDayStartUtc(filters.from);
    const end = new Date(tashkentDayStartUtc(filters.to).getTime() + DAY);
    const shifts = await this.prisma.workLog.findMany({
      where: { clockInAt: { lt: end }, clockOutAt: { not: null, gt: start } },
      select: {
        driverId: true,
        clockInAt: true,
        clockOutAt: true,
        breakMinutes: true,
        driver: {
          select: {
            user: { select: { name: true } },
            vehicle: { select: { id: true, plateNumber: true, model: true } },
          },
        },
      },
      orderBy: { clockInAt: 'asc' },
    });
    const driverIds = [...new Set(shifts.map((s) => s.driverId))];
    const orders = driverIds.length
      ? await this.prisma.order.findMany({
          where: {
            assignedDriverId: { in: driverIds },
            journeyStartedAt: { not: null, lt: end },
            // Long-finished ones cannot touch the range.
            OR: [{ deliveredAt: null }, { deliveredAt: { gt: start } }, { returnedAt: { gt: start } }],
          },
          select: {
            assignedDriverId: true,
            status: true,
            journeyStartedAt: true,
            deliveredAt: true,
            returnedAt: true,
            updatedAt: true,
          },
        })
      : [];

    const shiftsOf = new Map<string, IdleShift[]>();
    const who = new Map<string, { name: string; vehicle: { id: string; plateNumber: string; model: string | null } | null }>();
    for (const s of shifts) {
      shiftsOf.set(s.driverId, [...(shiftsOf.get(s.driverId) ?? []), s]);
      who.set(s.driverId, { name: s.driver.user?.name ?? '—', vehicle: s.driver.vehicle });
    }
    const busyOfDriver = new Map<string, Busy[]>();
    for (const o of orders) {
      const b = busyOf(o, now);
      if (b && o.assignedDriverId) busyOfDriver.set(o.assignedDriverId, [...(busyOfDriver.get(o.assignedDriverId) ?? []), b]);
    }

    const toRow = (id: string, name: string, sub: string | null, days: Map<string, DayTimes>): IdleRow => {
      const list = [...days.entries()]
        .map(([date, d]) => ({ date, worked_minutes: d.worked, busy_minutes: d.busy, lunch_minutes: d.lunch, minutes: d.idle }))
        .sort((a, b) => (a.date < b.date ? -1 : 1));
      const sum = (k: 'worked_minutes' | 'busy_minutes' | 'lunch_minutes' | 'minutes') => list.reduce((s, d) => s + d[k], 0);
      return {
        id,
        name,
        sub,
        days: list,
        worked_minutes: sum('worked_minutes'),
        busy_minutes: sum('busy_minutes'),
        lunch_minutes: sum('lunch_minutes'),
        total_minutes: sum('minutes'),
      };
    };

    const drivers: IdleRow[] = [];
    const byVehicle = new Map<string, { plate: string; model: string | null; days: Map<string, DayTimes> }>();
    for (const [driverId, list] of shiftsOf) {
      const days = idleByDay(list, busyOfDriver.get(driverId) ?? [], filters);
      const w = who.get(driverId)!;
      drivers.push(toRow(driverId, w.name, w.vehicle?.plateNumber ?? null, days));
      if (!w.vehicle) continue;
      const v = byVehicle.get(w.vehicle.id) ?? { plate: w.vehicle.plateNumber, model: w.vehicle.model, days: new Map<string, DayTimes>() };
      for (const [date, d] of days) {
        const cur = v.days.get(date) ?? { worked: 0, busy: 0, lunch: 0, idle: 0 };
        v.days.set(date, { worked: cur.worked + d.worked, busy: cur.busy + d.busy, lunch: cur.lunch + d.lunch, idle: cur.idle + d.idle });
      }
      byVehicle.set(w.vehicle.id, v);
    }
    const vehicles = [...byVehicle.entries()].map(([id, v]) => toRow(id, v.plate, v.model, v.days));
    const byTotal = (a: IdleRow, b: IdleRow) => b.total_minutes - a.total_minutes || a.name.localeCompare(b.name);
    return { vehicles: vehicles.sort(byTotal), drivers: drivers.sort(byTotal) };
  }

  /** The month-end workbook: each lorry's and each driver's hours worked, on orders and idle. */
  async exportXlsx(filters: TimesheetFilterInput): Promise<{ filename: string; base64: string }> {
    const data = await this.report(filters);
    const wb = new ExcelJS.Workbook();
    const hours = (m: number) => Math.round((m / 60) * 10) / 10;
    const sheet = (title: string, nameHeader: string, subHeader: string, rows: IdleRow[]) => {
      const ws = wb.addWorksheet(title);
      ws.addRow([`${title}: ish vaqti, ${dmy(filters.from)} — ${dmy(filters.to)}`]).font = { bold: true, size: 13 };
      ws.addRow([]);
      const head = ws.addRow(['№', nameHeader, subHeader, 'Kunlar', 'Smena vaqti (soat)', 'Zakazda (soat)', 'Obed (soat)', 'Zakazsiz (soat)']);
      head.font = { bold: true };
      head.eachCell((c) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE7D3' } };
        c.border = { bottom: { style: 'thin' } };
      });
      rows.forEach((r, i) => {
        ws.addRow([i + 1, r.name, r.sub ?? '', r.days.length, hours(r.worked_minutes), hours(r.busy_minutes), hours(r.lunch_minutes), hours(r.total_minutes)]);
      });
      const sum = (k: 'worked_minutes' | 'busy_minutes' | 'lunch_minutes' | 'total_minutes') => hours(rows.reduce((s, r) => s + r[k], 0));
      const total = ws.addRow(['', 'Jami', '', '', sum('worked_minutes'), sum('busy_minutes'), sum('lunch_minutes'), sum('total_minutes')]);
      total.font = { bold: true };
      ws.columns = [{ width: 5 }, { width: 22 }, { width: 34 }, { width: 9 }, { width: 15 }, { width: 15 }, { width: 12 }, { width: 15 }];
      for (const c of [5, 6, 7, 8]) ws.getColumn(c).numFmt = '0.0';
    };
    sheet('Mashinalar', 'Mashina', 'Nomi', data.vehicles);
    sheet('Haydovchilar', 'Haydovchi', 'Mashina', data.drivers);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    return { filename: `Ish_vaqti_${dmy(filters.from)}_${dmy(filters.to)}.xlsx`, base64: buf.toString('base64') };
  }
}

function dmy(s: string): string {
  return s.split('-').reverse().join('.');
}
