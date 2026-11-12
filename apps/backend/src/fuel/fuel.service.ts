import { syncFuelExpense } from '../expenses/auto-expense';
import { onBreakAt } from '../drivers/gps-window';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { FuelLog as FuelLogRow, FuelStation as FuelStationRow, Prisma } from '@prisma/client';
import {
  FUEL_REVIEW_FLAGS,
  FUEL_UNITS,
  type ConfirmFuelLogInput,
  type CorrectFuelReadingInput,
  type CreateFuelLogInput,
  type CreateFuelStationInput,
  type FuelDriverDebt,
  type FuelLog,
  type FuelLogFlag,
  type FuelLogOutcome,
  type FuelSettlement,
  type FuelSettlementState,
  type FuelStation,
  type FuelStationTotal,
  type FuelSummary,
  type FuelType,
  type NearbyFuelStation,
  type SettleFuelLogInput,
  type UpdateFuelStationInput,
  FUEL_STATION_FENCE_RADIUS_M,
} from '@bigant/shared';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { UploadService } from '../upload/upload.service';
import type { AuthenticatedUser as Actor } from '../common/decorators/current-user.decorator';
import { arithmeticHolds, classifyFill, nearestStations, type TimedFix } from './fuel.geometry';
import { FuelReaderService } from './fuel-reader.service';
import { shrinkForReading } from '../upload/upload.service';
import { TelegramService } from '../telegram/telegram.service';

type LogWithStations = FuelLogRow & {
  selectedStation: FuelStationRow | null;
  resolvedStation: FuelStationRow | null;
  driver?: { user: { name: string } | null } | null;
  vehicle?: { plateNumber: string; model: string } | null;
  reviewedBy?: { name: string; role: string } | null;
};

const LOG_INCLUDE = {
  selectedStation: true,
  resolvedStation: true,
  driver: { select: { user: { select: { name: true } } } },
  vehicle: { select: { plateNumber: true, model: true } },
  reviewedBy: { select: { name: true, role: true } },
} as const;

/** The three settlement states as Prisma sees them. */
const SETTLEMENT_STATE_WHERE: Record<FuelSettlementState, Prisma.FuelLogWhereInput> = {
  pending: { settlement: null },
  unpaid: { settlement: { not: null }, settledAt: null },
  paid: { settledAt: { not: null } },
};

type Period = { from?: Date; to?: Date };
const inPeriod = (p: Period): Prisma.FuelLogWhereInput =>
  p.from || p.to
    ? { capturedAt: { ...(p.from ? { gte: p.from } : {}), ...(p.to ? { lte: p.to } : {}) } }
    : {};

/**
 * Who pays, decided by where the truck was. Matched and corrected fills go
 * on the station's invoice; an unlisted fill is the driver's money. A
 * mismatch or an unverified log gets no default — a person decides.
 */
const DEFAULT_SETTLEMENT: Record<FuelLogOutcome, FuelSettlement | null> = {
  matched: 'station_invoice',
  other_station: 'station_invoice',
  unlisted: 'driver_reimbursement',
  // Named one of ours but stood nowhere near any: bought elsewhere, own money.
  mismatch: 'driver_reimbursement',
  unverified: null,
};

/**
 * Where the fence is happy but the numbers are in doubt, nobody is charged
 * until a person has looked — a wrong total lands on an invoice otherwise.
 */
function settlementFor(
  outcome: FuelLogOutcome,
  flags: readonly FuelLogFlag[],
): FuelSettlement | null {
  if (flags.some((f) => (FUEL_REVIEW_FLAGS as readonly string[]).includes(f))) return null;
  return DEFAULT_SETTLEMENT[outcome];
}

/** The reading the driver sends against the one the photo gave, to the cent. */
function sameReading(
  input: ConfirmFuelLogInput,
  log: {
    extractedTotalSum: number | null;
    extractedQuantity: number | null;
    extractedUnitPriceSum: number | null;
  },
): boolean {
  const close = (a: number, b: number | null) => b != null && Math.abs(a - b) < 0.0005;
  return (
    close(input.total_sum, log.extractedTotalSum) &&
    close(input.quantity, log.extractedQuantity) &&
    close(input.unit_price_sum, log.extractedUnitPriceSum)
  );
}

/**
 * Does quantity × unit price give the total the display shows? A pump rounds
 * to the so'm, and the quantity it shows is cut to two decimals, so the total
 * may differ by up to half a hundredth of the price — plus a so'm or two.
 * Anything further off means a digit was read wrong.
 */
export function arithmeticAgrees(r: {
  total_sum: number | null;
  quantity: number | null;
  unit_price_sum: number | null;
}): boolean {
  if (r.total_sum == null || r.quantity == null || r.unit_price_sum == null) return true;
  const tolerance = Math.max(r.unit_price_sum * 0.005 + 2, 5);
  return Math.abs(r.quantity * r.unit_price_sum - r.total_sum) <= tolerance;
}

@Injectable()
export class FuelService {
  private readonly logger = new Logger(FuelService.name);

  /** The fill's cost in Xarajatlar; the fill is saved whatever happens here. */
  private syncExpense(logId: string): void {
    void syncFuelExpense(this.prisma, logId).catch((err: Error) =>
      this.logger.warn(`fuel expense sync failed: ${err?.message}`),
    );
  }
  constructor(
    private readonly prisma: PrismaService,
    private readonly upload: UploadService,
    private readonly reader: FuelReaderService,
    private readonly telegram: TelegramService,
    config: ConfigService<Env, true>,
  ) {
    this.fenceOff = config.get('FUEL_FENCE_CHECK', { infer: true }) === 'off';
  }

  /** While the fleet is tested from the office, a fill-up away from the
   *  station's pin is not held for review; the distance is still written. */
  private readonly fenceOff: boolean;

  /** What the phone needs to know before it gates the camera on arrival. */
  config(): { fence_check: boolean; fence_radius_m: number } {
    return { fence_check: !this.fenceOff, fence_radius_m: FUEL_STATION_FENCE_RADIUS_M };
  }

  // --- Stations ---

  /** What a driver can pick from: live contracted stations, optionally selling this fuel. */
  async listStations(fuelType?: FuelType): Promise<FuelStation[]> {
    const rows = await this.prisma.fuelStation.findMany({
      where: {
        active: true,
        contracted: true,
        ...(fuelType ? { fuelTypes: { has: fuelType } } : {}),
      },
      orderBy: { name: 'asc' },
    });
    return rows.map(toStation);
  }

  /** Everything, for the people who maintain the list. */
  async listAllStations(): Promise<FuelStation[]> {
    const rows = await this.prisma.fuelStation.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    return rows.map(toStation);
  }

  /**
   * "Yaqinimda": the nearest contracted stations selling this fuel.
   *
   * Within the near-me radius the answer is the handful around the driver. Out
   * of range it is the single nearest one anyway, with its true distance — a
   * driver who taps the button on the far side of the city wants to be told
   * "Yujniy, 12 km" and routed there, not handed an empty list.
   */
  async nearbyStations(
    at: { lat: number; lng: number },
    fuelType: FuelType,
  ): Promise<NearbyFuelStation[]> {
    const rows = await this.prisma.fuelStation.findMany({
      where: { active: true, contracted: true },
    });
    const near = nearestStations(at, rows, fuelType);
    // Wherever the driver is, he sees the closest contracted stations: the
    // ones within range, or, out in the viloyat, simply the two nearest — so
    // there is always something to pick and drive to.
    const found =
      near.length > 0
        ? near
        : nearestStations(at, rows, fuelType, { limit: 2, radiusM: Number.POSITIVE_INFINITY });
    return found.map(({ station, distanceM }) => ({
      ...toStation(station),
      distance_m: Math.round(distanceM),
    }));
  }

  async createStation(input: CreateFuelStationInput): Promise<FuelStation> {
    assertPinnedOrUnpinned(input);
    const row = await this.prisma.fuelStation.create({ data: stationData(input) });
    return toStation(row);
  }

  async updateStation(id: string, input: UpdateFuelStationInput): Promise<FuelStation> {
    const existing = await this.prisma.fuelStation.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('fuel_station_not_found');
    assertPinnedOrUnpinned({ lat: input.lat ?? existing.lat, lng: input.lng ?? existing.lng });
    const row = await this.prisma.fuelStation.update({ where: { id }, data: stationData(input) });
    return toStation(row);
  }

  // --- Logs ---

  /**
   * The photo has been taken. Store it, work out where the truck was, and
   * open a draft the driver will confirm the numbers on.
   *
   * The classification happens here, at capture, not at confirm: the
   * position is only meaningful at the moment of the photo, and a driver who
   * never confirms still leaves a record of having been somewhere.
   */
  async createDraft(input: CreateFuelLogInput, actor: Actor): Promise<FuelLog> {
    const driver = await this.driverOf(actor);
    // Not on a break (owner, 12.11.2026): his position is not taken then, and a
    // fill-up is checked by it. He ends the break first.
    if (onBreakAt(driver, new Date())) throw new ConflictException('driver_on_break');

    if (input.station_id) {
      const station = await this.prisma.fuelStation.findUnique({ where: { id: input.station_id } });
      if (!station || !station.active) throw new BadRequestException('fuel_station_not_found');
    }

    const stations = await this.prisma.fuelStation.findMany({ where: { active: true } });
    // Never later than now (06.11.2026): the photo time counts as his last
    // photo of the day, and a future one would stretch his evening pay.
    const capturedAt = new Date(Math.min(Date.parse(input.captured_at), Date.now()));
    const capture: TimedFix | null = input.position
      ? { lat: input.position.lat, lng: input.position.lng, at: capturedAt }
      : null;
    const tracked: TimedFix | null =
      driver.locationLat != null && driver.locationLng != null && driver.locationUpdatedAt
        ? { lat: driver.locationLat, lng: driver.locationLng, at: driver.locationUpdatedAt }
        : null;

    const verdict = classifyFill({
      selectedStationId: input.station_id ?? null,
      capture,
      tracked,
      stations,
    });
    const outcome = this.fenceOff && verdict.outcome === 'mismatch' ? 'matched' : verdict.outcome;

    // The upload and the reading are independent and both slow; run them
    // together. The reader gets a 1280px copy — all it needs, a fraction of
    // the bytes. A reading that fails is null and costs the driver nothing.
    const t0 = Date.now();
    const small = await shrinkForReading(input.photo_base64);
    const [photoUrl, rawReading] = await Promise.all([
      this.upload.uploadBase64(input.photo_base64, 'fuel-logs'),
      this.reader.read(small, input.fuel_type),
    ]);
    // A display whose three numbers do not multiply out is a misread digit,
    // however sure the model says it is: the driver is asked, never auto-saved.
    const reading =
      rawReading && !arithmeticAgrees(rawReading)
        ? { ...rawReading, confidence: Math.min(rawReading.confidence ?? 70, 70) }
        : rawReading;
    this.logger.log(
      // "since the shot": the phone's part of the wait (encoding and the
      // upload) — what the driver waits beyond this server's own time.
      `fuel photo: ${Math.round(input.photo_base64.length / 1024)} KB in, ${Math.round(small.length / 1024)} KB to reader, ${Date.now() - t0} ms` +
        (input.captured_at ? `, ${t0 - Date.parse(input.captured_at)} ms since the shot` : ''),
    );

    // The display's own unit against the fuel the driver tapped: a "gaz"
    // fill whose dispenser says litres is worth a person's glance.
    const flags = [...verdict.flags];
    if (reading?.readable && reading.unit && reading.unit !== FUEL_UNITS[input.fuel_type])
      flags.push('unit_mismatch');
    for (const line of reading?.unclear ?? []) flags.push(`unclear_${line}` as FuelLogFlag);

    const row = await this.prisma.fuelLog.create({
      data: {
        driverId: driver.id,
        vehicleId: driver.vehicleId,
        fuelType: input.fuel_type,
        photoUrl,
        selectedStationId: input.station_id ?? null,
        resolvedStationId: verdict.resolvedStationId,
        capturedAt,
        captureLat: capture?.lat ?? null,
        captureLng: capture?.lng ?? null,
        captureAccuracyM: input.position?.accuracy_m ?? null,
        trackedLat: tracked?.lat ?? null,
        trackedLng: tracked?.lng ?? null,
        trackedAt: tracked?.at ?? null,
        distanceM: verdict.distanceM,
        trackingGapM: verdict.trackingGapM,
        outcome,
        flags,
        extractedReadable: reading ? reading.readable : null,
        extractedConfidence: reading?.confidence ?? null,
        extractedReason: reading?.reason ?? null,
        extractedUnit: reading?.unit ?? null,
        extractedTotalSum: reading?.total_sum ?? null,
        extractedQuantity: reading?.quantity ?? null,
        extractedUnitPriceSum: reading?.unit_price_sum ?? null,
      },
      include: LOG_INCLUDE,
    });
    return toLog(row);
  }

  /**
   * The driver has looked at the numbers and says they are right.
   *
   * A reading whose arithmetic does not hold is still accepted — the driver
   * is the one standing in front of the dispenser — but it is flagged, so
   * the person settling it looks at the photo first.
   */
  async confirm(logId: string, input: ConfirmFuelLogInput, actor: Actor): Promise<FuelLog> {
    const driver = await this.driverOf(actor);
    const log = await this.prisma.fuelLog.findUnique({ where: { id: logId } });
    if (!log) throw new NotFoundException('fuel_log_not_found');
    if (log.driverId !== driver.id) throw new ForbiddenException('not_your_fuel_log');
    if (log.status !== 'draft') throw new ConflictException('fuel_log_already_confirmed');

    // When the photo was read, the driver either confirms the numbers as
    // they are or edits them. An edit is kept, and marked: the AI's reading
    // stays in the extracted columns, the driver's in the confirmed ones,
    // and the log is held for a person to compare the two with the photo
    // instead of being settled on its own.
    const flags = new Set(log.flags as FuelLogFlag[]);
    if (log.extractedReadable && !sameReading(input, log)) flags.add('driver_edited');
    if (arithmeticHolds(input)) flags.delete('arithmetic_off');
    else flags.add('arithmetic_off');

    // Conditional (06.11.2026): two taps at once confirmed it twice and sent
    // two photos to the fuel group.
    const claimed = await this.prisma.fuelLog.updateMany({
      where: { id: logId, status: 'draft' },
      data: { status: 'confirmed' },
    });
    if (claimed.count === 0) throw new ConflictException('fuel_log_already_confirmed');
    const row = await this.prisma.fuelLog.update({
      where: { id: logId },
      data: {
        status: 'confirmed',
        totalSum: input.total_sum,
        quantity: input.quantity,
        unitPriceSum: input.unit_price_sum,
        confirmedAt: new Date(),
        flags: [...flags],
        settlement: settlementFor(log.outcome as FuelLogOutcome, [...flags]),
      },
      include: LOG_INCLUDE,
    });
    // The dispenser photo goes to the fuel group, as the driver used to post it
    // by hand. The log is confirmed either way; a Telegram hiccup is retried.
    void this.telegram
      .createForFuel(row)
      .catch((err: Error) => this.logger.warn(`telegram fuel report failed: ${err.message}`));
    this.syncExpense(row.id);
    return toLog(row);
  }

  /**
   * An admin corrects the three numbers against the photo. The driver's
   * entry is kept as the original the first time round; the flags are
   * recomputed, and a log with no settlement yet gets one if the correction
   * cleared what was holding it. Paid logs are closed to this, like every
   * other change.
   */
  async correctReading(
    logId: string,
    input: CorrectFuelReadingInput,
    actor: Actor,
  ): Promise<FuelLog> {
    const log = await this.prisma.fuelLog.findUnique({ where: { id: logId } });
    if (!log) throw new NotFoundException('fuel_log_not_found');
    if (log.status !== 'confirmed') throw new ConflictException('fuel_log_not_confirmed');
    if (log.settledAt) throw new ConflictException('fuel_log_already_paid');

    const flags = new Set(log.flags as FuelLogFlag[]);
    if (arithmeticHolds(input)) flags.delete('arithmetic_off');
    else flags.add('arithmetic_off');
    const close = (a: number, b: number | null) => b != null && Math.abs(a - b) < 0.0005;
    const changed =
      input.corrected === true ||
      !(
        close(input.total_sum, log.totalSum) &&
        close(input.quantity, log.quantity) &&
        close(input.unit_price_sum, log.unitPriceSum)
      );
    // The office has now looked at the fill and saved it: whatever held it
    // for review — the driver's edit, a missing GPS fix, a doubtful digit —
    // is answered. It settles by its outcome; where the outcome names no
    // payer, a chosen station is invoiced and a street fill is the driver's.
    // The flags stay, so the log is still listed for what it was.
    const reviewed =
      DEFAULT_SETTLEMENT[log.outcome as FuelLogOutcome] ??
      (log.resolvedStationId || log.selectedStationId ? 'station_invoice' : 'driver_reimbursement');

    // Not once it is paid, even if the payment landed after the read above (audit, 07.11.2026).
    const { count } = await this.prisma.fuelLog.updateMany({
      where: { id: logId, settledAt: null },
      data: {
        totalSum: input.total_sum,
        quantity: input.quantity,
        unitPriceSum: input.unit_price_sum,
        // Snapshot the driver's numbers once, and only when they were changed:
        // an approval of them as they stand is not a correction.
        ...(changed && log.originalTotalSum == null
          ? {
              originalTotalSum: log.totalSum,
              originalQuantity: log.quantity,
              originalUnitPriceSum: log.unitPriceSum,
            }
          : {}),
        reviewedById: actor.userId,
        reviewedAt: new Date(),
        flags: [...flags],
        // Numbers that still do not multiply out are not an approval: held.
        ...(log.settlement == null && arithmeticHolds(input) ? { settlement: reviewed } : {}),
      },
    });
    if (count === 0) throw new ConflictException('fuel_log_already_paid');
    this.syncExpense(logId);
    return toLog(await this.prisma.fuelLog.findUniqueOrThrow({ where: { id: logId }, include: LOG_INCLUDE }));
  }

  async myLogs(actor: Actor, limit = 50): Promise<FuelLog[]> {
    const driver = await this.driverOf(actor);
    const rows = await this.prisma.fuelLog.findMany({
      where: { driverId: driver.id },
      include: LOG_INCLUDE,
      orderBy: { capturedAt: 'desc' },
      take: limit,
    });
    return rows.map(toLog);
  }

  async listLogs(
    filters: {
      driver_id?: string;
      station_id?: string;
      fuel_type?: FuelType;
      outcome?: FuelLogOutcome;
      edited?: 'driver' | 'office' | 'dispatcher' | 'admin';
      settlement_state?: FuelSettlementState;
      skip?: number;
      take?: number;
    } & Period,
  ): Promise<FuelLog[]> {
    const where: Prisma.FuelLogWhereInput = {
      status: 'confirmed',
      ...(filters.driver_id ? { driverId: filters.driver_id } : {}),
      ...(filters.station_id ? { resolvedStationId: filters.station_id } : {}),
      ...(filters.fuel_type ? { fuelType: filters.fuel_type } : {}),
      ...(filters.outcome ? { outcome: filters.outcome } : {}),
      // The driver typed over the reading; or the office corrected it later
      // (the driver's own numbers are then kept as the original).
      ...(filters.edited === 'driver' ? { flags: { has: 'driver_edited' } } : {}),
      ...(filters.edited === 'office' ? { originalTotalSum: { not: null } } : {}),
      // Split by who saved the correction: an admin, or anyone else in the office.
      // Everything the office checked, changed or approved as it stood, by the reviewer's role.
      ...(filters.edited === 'admin'
        ? { reviewedById: { not: null }, reviewedBy: { role: 'admin' as const } }
        : {}),
      ...(filters.edited === 'dispatcher'
        ? { reviewedById: { not: null }, NOT: { reviewedBy: { role: 'admin' as const } } }
        : {}),
      ...(filters.settlement_state ? SETTLEMENT_STATE_WHERE[filters.settlement_state] : {}),
      ...inPeriod(filters),
    };
    const rows = await this.prisma.fuelLog.findMany({
      where,
      include: LOG_INCLUDE,
      orderBy: { capturedAt: 'desc' },
      skip: filters.skip ?? 0,
      // Still bounded, but a caller that needs the whole month can walk it.
      take: filters.take ?? 500,
    });
    return rows.map(toLog);
  }

  async getLog(id: string): Promise<FuelLog> {
    const row = await this.prisma.fuelLog.findUnique({ where: { id }, include: LOG_INCLUDE });
    if (!row) throw new NotFoundException('fuel_log_not_found');
    return toLog(row);
  }

  /**
   * A person decides who pays. Used for the queue the fence could not settle,
   * and to correct a settlement the fence got wrong.
   *
   * Filing under a station also names the station, and that becomes the
   * resolved one — the invoice reconciliation reads `resolvedStationId`, so a
   * log moved to a station must count towards that station's month.
   * Anything already paid is left alone; unpicking a payment is bookkeeping,
   * not a click.
   */
  async settle(id: string, input: SettleFuelLogInput): Promise<FuelLog> {
    const log = await this.prisma.fuelLog.findUnique({ where: { id } });
    if (!log) throw new NotFoundException('fuel_log_not_found');
    if (log.status !== 'confirmed') throw new ConflictException('fuel_log_not_confirmed');
    if (log.settledAt) throw new ConflictException('fuel_log_already_paid');

    if (input.settlement === 'station_invoice') {
      const station = await this.prisma.fuelStation.findUnique({
        where: { id: input.station_id! },
      });
      if (!station) throw new BadRequestException('fuel_station_not_found');
    }
    const { count } = await this.prisma.fuelLog.updateMany({
      where: { id, settledAt: null }, // (audit, 07.11.2026)
      data: {
        settlement: input.settlement,
        ...(input.settlement === 'station_invoice' ? { resolvedStationId: input.station_id! } : {}),
      },
    });
    if (count === 0) throw new ConflictException('fuel_log_already_paid');
    return toLog(await this.prisma.fuelLog.findUniqueOrThrow({ where: { id }, include: LOG_INCLUDE }));
  }

  /** The tiles: one period, in numbers. */
  async summary(period: Period): Promise<FuelSummary> {
    const rows = await this.prisma.fuelLog.findMany({
      where: { status: 'confirmed', ...inPeriod(period) },
      select: {
        driverId: true,
        resolvedStationId: true,
        fuelType: true,
        totalSum: true,
        quantity: true,
        settlement: true,
      },
    });
    const drivers = new Set<string>();
    const stations = new Set<string>();
    let total = 0;
    let nm3 = 0;
    let l = 0;
    let pending = 0;
    for (const r of rows) {
      drivers.add(r.driverId);
      if (r.resolvedStationId) stations.add(r.resolvedStationId);
      total += r.totalSum ?? 0;
      if (FUEL_UNITS[r.fuelType as FuelType] === 'nm3') nm3 += r.quantity ?? 0;
      else l += r.quantity ?? 0;
      if (r.settlement === null) pending += 1;
    }
    return {
      total_sum: round1(total),
      volume_nm3: round3(nm3),
      volume_l: round3(l),
      count: rows.length,
      drivers: drivers.size,
      stations: stations.size,
      pending_review: pending,
    };
  }

  /** Per contracted station, what our logs say it should be invoicing. */
  async stationTotals(period: Period): Promise<FuelStationTotal[]> {
    const rows = await this.prisma.fuelLog.findMany({
      where: {
        status: 'confirmed',
        settlement: 'station_invoice',
        resolvedStationId: { not: null },
        ...inPeriod(period),
      },
      select: { resolvedStationId: true, fuelType: true, totalSum: true, quantity: true },
    });
    const byStation = new Map<string, { count: number; nm3: number; l: number; sum: number }>();
    for (const r of rows) {
      const acc = byStation.get(r.resolvedStationId!) ?? { count: 0, nm3: 0, l: 0, sum: 0 };
      acc.count += 1;
      acc.sum += r.totalSum ?? 0;
      if (FUEL_UNITS[r.fuelType as FuelType] === 'nm3') acc.nm3 += r.quantity ?? 0;
      else acc.l += r.quantity ?? 0;
      byStation.set(r.resolvedStationId!, acc);
    }
    const stations = await this.prisma.fuelStation.findMany({
      where: { id: { in: [...byStation.keys()] } },
    });
    return stations
      .flatMap((st) => {
        const acc = byStation.get(st.id);
        if (!acc) return [];
        return [
          {
            station: toStation(st),
            count: acc.count,
            volume_nm3: round3(acc.nm3),
            volume_l: round3(acc.l),
            total_sum: round1(acc.sum),
          },
        ];
      })
      .sort((a, b) => b.total_sum - a.total_sum);
  }

  /** Who is owed what, for fills they paid for and have not been repaid. */
  async driverDebts(): Promise<FuelDriverDebt[]> {
    const rows = await this.prisma.fuelLog.findMany({
      where: { status: 'confirmed', settlement: 'driver_reimbursement', settledAt: null },
      include: {
        driver: { select: { user: { select: { name: true } } } },
        vehicle: { select: { plateNumber: true } },
      },
      orderBy: { capturedAt: 'asc' },
    });
    const byDriver = new Map<string, FuelDriverDebt>();
    for (const r of rows) {
      const cur = byDriver.get(r.driverId);
      if (cur) {
        cur.count += 1;
        cur.total_sum = round1(cur.total_sum + (r.totalSum ?? 0));
      } else {
        byDriver.set(r.driverId, {
          driver_id: r.driverId,
          driver_name: r.driver?.user?.name ?? null,
          vehicle_plate: r.vehicle?.plateNumber ?? null,
          count: 1,
          total_sum: round1(r.totalSum ?? 0),
          oldest_at: r.capturedAt.toISOString(),
        });
      }
    }
    return [...byDriver.values()].sort((a, b) => b.total_sum - a.total_sum);
  }

  /**
   * One handover of cash closes every reimbursement the driver was owed up to
   * that day. Per driver per period rather than per log — that is how the
   * money actually changes hands.
   */
  /**
   * One fill paid back on its own — the office does not always hand over a
   * driver's whole balance at once. Only a driver-paid fill not yet paid.
   */
  async payLog(id: string): Promise<{ paid: number; total_sum: number }> {
    const log = await this.prisma.fuelLog.findUnique({
      where: { id },
      select: { totalSum: true, settlement: true, status: true },
    });
    if (!log) throw new NotFoundException('fuel_log_not_found');
    if (log.status !== 'confirmed') throw new ConflictException('fuel_log_not_confirmed');
    if (log.settlement !== 'driver_reimbursement')
      throw new ConflictException('fuel_log_not_driver_paid');
    // Same guard as the whole-balance payment: a second tap pays nothing.
    const paid = await this.prisma.fuelLog.updateMany({
      where: { id, settlement: 'driver_reimbursement', settledAt: null },
      data: { settledAt: new Date() },
    });
    return { paid: paid.count, total_sum: paid.count ? round1(log.totalSum ?? 0) : 0 };
  }

  async payDriver(driverId: string, upTo: Date): Promise<{ paid: number; total_sum: number }> {
    const due = await this.prisma.fuelLog.findMany({
      where: {
        driverId,
        status: 'confirmed',
        settlement: 'driver_reimbursement',
        settledAt: null,
        capturedAt: { lte: upTo },
      },
      select: { id: true, totalSum: true },
    });
    if (due.length === 0) return { paid: 0, total_sum: 0 };
    // Settle only what is still unsettled. Two taps on "To'landi" — a slow
    // request tapped twice, or two people at once — both read the same rows;
    // without this condition both answered "paid 3, 450 000", and the office
    // handed the driver the money twice on the strength of the second receipt.
    // The sum is of the rows this call stamped, not of all it read: a race that
    // paid some of them elsewhere used to overstate it (audit, 07.11.2026).
    const now = new Date();
    const ids = due.map((d) => d.id);
    const paid = await this.prisma.fuelLog.updateMany({
      where: { id: { in: ids }, settledAt: null },
      data: { settledAt: now },
    });
    if (paid.count === 0) return { paid: 0, total_sum: 0 };
    const mine = await this.prisma.fuelLog.findMany({ where: { id: { in: ids }, settledAt: now }, select: { totalSum: true } });
    return { paid: mine.length, total_sum: round1(mine.reduce((s, d) => s + (d.totalSum ?? 0), 0)) };
  }

  private async driverOf(actor: Actor) {
    const driver = await this.prisma.driver.findUnique({ where: { userId: actor.userId } });
    if (!driver) throw new ForbiddenException('driver_only');
    return driver;
  }
}

/** Either both coordinates or neither; a lone latitude is a typo, not a place. */
function assertPinnedOrUnpinned(p: { lat?: number | null; lng?: number | null }): void {
  if ((p.lat == null) !== (p.lng == null))
    throw new BadRequestException('fuel_station_half_pinned');
}

function stationData(input: CreateFuelStationInput | UpdateFuelStationInput) {
  return {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.brand !== undefined ? { brand: input.brand ?? null } : {}),
    ...(input.address !== undefined ? { address: input.address ?? null } : {}),
    ...(input.lat !== undefined ? { lat: input.lat ?? null } : {}),
    ...(input.lng !== undefined ? { lng: input.lng ?? null } : {}),
    ...(input.fuel_types !== undefined ? { fuelTypes: input.fuel_types } : {}),
    ...(input.contracted !== undefined ? { contracted: input.contracted } : {}),
    ...(input.active !== undefined ? { active: input.active } : {}),
  } as Prisma.FuelStationUncheckedCreateInput;
}

function toStation(r: FuelStationRow): FuelStation {
  return {
    id: r.id,
    name: r.name,
    brand: r.brand,
    address: r.address,
    lat: r.lat,
    lng: r.lng,
    fuel_types: r.fuelTypes as FuelType[],
    contracted: r.contracted,
    active: r.active,
  };
}

function toLog(r: LogWithStations): FuelLog {
  const reading = (t: number | null, q: number | null, u: number | null) =>
    t != null && q != null && u != null ? { total_sum: t, quantity: q, unit_price_sum: u } : null;
  return {
    id: r.id,
    status: r.status,
    fuel_type: r.fuelType,
    unit: FUEL_UNITS[r.fuelType as FuelType],
    photo_url: r.photoUrl,
    driver_id: r.driverId,
    vehicle_id: r.vehicleId,
    selected_station: r.selectedStation ? toStation(r.selectedStation) : null,
    resolved_station: r.resolvedStation ? toStation(r.resolvedStation) : null,
    outcome: r.outcome,
    flags: r.flags as FuelLogFlag[],
    distance_m: r.distanceM,
    captured_at: r.capturedAt.toISOString(),
    extracted: reading(r.extractedTotalSum, r.extractedQuantity, r.extractedUnitPriceSum),
    read_attempt:
      r.extractedTotalSum != null || r.extractedQuantity != null || r.extractedUnitPriceSum != null
        ? {
            total_sum: r.extractedTotalSum,
            quantity: r.extractedQuantity,
            unit_price_sum: r.extractedUnitPriceSum,
          }
        : null,
    extracted_readable: r.extractedReadable,
    extracted_confidence: r.extractedConfidence,
    extracted_reason: (r.extractedReason as FuelLog['extracted_reason']) ?? null,
    confirmed: reading(r.totalSum, r.quantity, r.unitPriceSum),
    original: reading(r.originalTotalSum, r.originalQuantity, r.originalUnitPriceSum),
    reviewed_by_name: r.reviewedBy?.name ?? null,
    reviewed_by_role: (r.reviewedBy?.role as FuelLog['reviewed_by_role']) ?? null,
    reviewed_at: r.reviewedAt ? r.reviewedAt.toISOString() : null,
    settlement: r.settlement,
    settled_at: r.settledAt ? r.settledAt.toISOString() : null,
    driver_name: r.driver?.user?.name ?? null,
    vehicle_plate: r.vehicle?.plateNumber ?? null,
    vehicle_model: r.vehicle?.model ?? null,
    capture:
      r.captureLat != null && r.captureLng != null
        ? { lat: r.captureLat, lng: r.captureLng, accuracy_m: r.captureAccuracyM }
        : null,
    tracked:
      r.trackedLat != null && r.trackedLng != null && r.trackedAt
        ? { lat: r.trackedLat, lng: r.trackedLng, at: r.trackedAt.toISOString() }
        : null,
    tracking_gap_m: r.trackingGapM,
    created_at: r.createdAt.toISOString(),
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
