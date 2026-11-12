import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { MorningStart as MorningStartRow } from '@prisma/client';
import type { MorningStart } from '@bigant/shared';
import { PrismaService } from '../prisma/prisma.service';
import { metresBetween } from '../poputi/poputi.geometry';
import { tashkentDayStartUtc } from '../common/tashkent-time';
import { shiftStartUtcMs } from '../common/shift-clock';
import { isPayDayLocked } from '../payroll/period-lock';

const MIN = 60_000;
/** The lorry has set off once it is this far from where he pressed. */
export const MOVED_METRES = 300;
/** Fixes reach the server a little after they are taken; wait this long past 09:00. */
const LATE_FIX_MIN = 2;

type Ping = { lat: number; lng: number; recordedAt: Date };

/**
 * When the morning start happened, from the press and the GPS trail after it.
 * Only movement before 09:00 counts: from nine on it is the working day, and
 * there is no early start to pay. Pure, for the tests: null while the lorry
 * has not moved off before nine.
 */
export function settleMorningStart(
  press: { pressedAt: Date; pressLat: number | null; pressLng: number | null; day: Date },
  pings: Ping[],
): { movedAt: Date; startedAt: Date; earlyMinutes: number } | null {
  const nine = press.day.getTime() + shiftStartUtcMs();
  const after = pings.filter(
    (p) => p.recordedAt.getTime() >= press.pressedAt.getTime() - MIN && p.recordedAt.getTime() < nine,
  );
  const anchor =
    press.pressLat != null && press.pressLng != null
      ? { lat: press.pressLat, lng: press.pressLng }
      : after[0]
        ? { lat: after[0].lat, lng: after[0].lng }
        : null;
  if (!anchor) return null;
  const moved = after.find(
    (p) => p.recordedAt.getTime() >= press.pressedAt.getTime() && metresBetween(anchor, p) >= MOVED_METRES,
  );
  if (!moved) return null;
  // The start is when the lorry is seen 300 m off, not when the button was pressed.
  const startedAt = moved.recordedAt;
  const earlyMinutes = Math.floor((nine - startedAt.getTime()) / MIN);
  return { movedAt: moved.recordedAt, startedAt, earlyMinutes };
}

/** Tariff ÷ 60 × minutes, to the whole so'm. */
export function earlyAmount(rateHourSom: number, minutes: number): number {
  return Math.round((rateHourSom * minutes) / 60);
}

@Injectable()
export class MorningStartService {
  private readonly logger = new Logger(MorningStartService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Confirm each press whose lorry moved off before 09:00; past nine, give up on the rest. */
  async runOnce(now: Date = new Date()): Promise<{ confirmed: number; no_move: number }> {
    const waiting = await this.prisma.morningStart.findMany({ where: { status: 'waiting_gps' } });
    let confirmed = 0;
    let noMove = 0;
    for (const row of waiting) {
      const pings = await this.prisma.driverLocationPing.findMany({
        where: {
          driverId: row.driverId,
          recordedAt: { gte: new Date(row.pressedAt.getTime() - MIN), lt: new Date(row.day.getTime() + shiftStartUtcMs()) },
        },
        orderBy: { recordedAt: 'asc' },
        select: { lat: true, lng: true, recordedAt: true },
      });
      // A morning in a paid, locked period is never confirmed (owner, 07.11.2026).
      const locked = isPayDayLocked(row.day, now) || isPayDayLocked(row.pressedAt, now);
      const settled = locked ? null : settleMorningStart(row, pings);
      if (settled) {
        // Paid by the minute at the lorry class's hourly rate (owner, 29.10.2026):
        // 101 minutes at 70 000 = 117 833 so'm.
        const rateHourSom = await this.rateFor(row.driverId);
        const amountSom = earlyAmount(rateHourSom, settled.earlyMinutes);
        await this.prisma.morningStart.update({
          where: { id: row.id },
          data: { status: 'confirmed', ...settled, rateHourSom, amountSom },
        });
        this.logger.log(`morning start ${row.id}: ${settled.startedAt.toISOString()}, ${settled.earlyMinutes} min early`);
        confirmed++;
      } else if (now.getTime() >= row.day.getTime() + shiftStartUtcMs() + LATE_FIX_MIN * MIN) {
        // Not moved off by 09:00: the working day has begun, no early start.
        await this.prisma.morningStart.update({ where: { id: row.id }, data: { status: 'no_move' } });
        noMove++;
      }
    }
    return { confirmed, no_move: noMove };
  }

  /** The hourly early-start rate of the driver's lorry class; 0 without a lorry. */
  private async rateFor(driverId: string): Promise<number> {
    const d = await this.prisma.driver.findUnique({ where: { id: driverId }, select: { vehicle: { select: { category: true } } } });
    if (!d?.vehicle?.category) return 0;
    const t = await this.prisma.vehicleTariff.findUnique({ where: { category: d.vehicle.category }, select: { earlyHourSom: true } });
    return t?.earlyHourSom ?? 0;
  }

  /** One driver's, for a Tashkent month (admin); none = the latest 100. */
  async listFor(driverId: string, month?: string): Promise<MorningStart[]> {
    const range = month ? monthRange(month) : null;
    const rows = await this.prisma.morningStart.findMany({
      where: { driverId, ...(range ? { pressedAt: { gte: range.from, lt: range.to } } : {}) },
      orderBy: { day: 'desc' },
      take: 100,
      include: ORDER_CLIENT,
    });
    return rows.map(toPublic);
  }

  /** The driver's own, for a period. */
  async listMine(userId: string, from: Date, to: Date): Promise<MorningStart[]> {
    const driver = await this.prisma.driver.findUnique({ where: { userId }, select: { id: true } });
    if (!driver) throw new NotFoundException('Driver profile not found');
    const rows = await this.prisma.morningStart.findMany({
      where: { driverId: driver.id, pressedAt: { gte: from, lt: to } },
      orderBy: { day: 'desc' },
      include: ORDER_CLIENT,
    });
    return rows.map(toPublic);
  }
}

/** [from, to) of a YYYY-MM month in Tashkent time. */
function monthRange(month: string): { from: Date; to: Date } {
  const [y, m] = month.split('-').map(Number);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  return { from: tashkentDayStartUtc(`${month}-01`), to: tashkentDayStartUtc(`${next}-01`) };
}

const ORDER_CLIENT = { order: { select: { clientName: true } } } as const;

function toPublic(r: MorningStartRow & { order: { clientName: string } | null }): MorningStart {
  return {
    id: r.id,
    driver_id: r.driverId,
    day: r.day.toISOString().slice(0, 10),
    order_id: r.orderId,
    client_name: r.order?.clientName ?? null,
    action: r.action as MorningStart['action'],
    pressed_at: r.pressedAt.toISOString(),
    started_at: r.startedAt?.toISOString() ?? null,
    status: r.status as MorningStart['status'],
    early_minutes: r.earlyMinutes,
    rate_hour_som: r.rateHourSom,
    amount_som: r.amountSom,
  };
}
