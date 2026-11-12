import { forgetAccount } from '../common/active-account';
import { createHash, randomBytes } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import {
  Prisma,
  type Driver,
  type DriverDocument,
  type User,
  type Vehicle,
  type VehicleDocument,
  type WorkLog,
  type DriverBreak as DriverBreakRow,
} from '@prisma/client';
import {
  ACTIVE_ORDER_STATUSES,
  BLOCKING_ACTIVE_ORDER_STATUSES,
  IN_PROGRESS_ORDER_STATUSES,
  type CreateDriverDocumentInput,
  type CreateDriverInput,
  type DriverDocType,
  type DriverDocumentPublic,
  type DriverEarnings,
  type DriverLocationPublic,
  type DriverMe,
  type DriverPublic,
  type DriverStatus,
  type EarningsLine,
  type EarningsPeriod,
  type VehicleCategory,
  type VehicleTariff,
  type IncidentPublic,
  type KmDue,
  type KmRecordPublic,
  type ReportIncidentInput,
  type UpdateDriverDocumentInput,
  type ClockInInput,
  type ClockOutInput,
  type ExtendShiftInput,
  type TimesheetFilterInput,
  type TimesheetRow,
  type WorkReport,
  type UpdateDriverInput,
  type UpdateDriverLocationInput,
  type DriverLocationBatchInput,
  type WorkLogPublic,
  type CarryOverReason,
  type ShiftAlerts,
  type CorrectWorkLogInput,
  type DriverBreakInput,
  type DriverBreakExtendInput,
  type DriverBreakPublic,
  FUEL_GPS_STALE_MS,
  FUEL_STATION_FENCE_RADIUS_M,
} from '@bigant/shared';
import { ordersInHand, settleDriverStatus } from './driver-status';
import { metresBetween } from '../poputi/poputi.geometry';
import { isActionable } from '../orders/order-timing';
import { NotificationsService } from '../notifications/notifications.service';
import { CLOSE_AFTER_LAST_MIN, END_CHECK_MAX_UNANSWERED, END_CHECK_NOTE_MAX, isAwaitingAnswer, readEndCheckNotes } from './shift-end-check';
import { silentGaps } from './location-silence';
import { gpsOnlyWindow, gpsWindow } from './gps-window';
import { isPayDayLocked } from '../payroll/period-lock';
import {
  breakTakenMinutes,
  earlyMinutesAt,
  lateMinutesAt,
  netMinutes,
  readOffPeriods,
  SHIFT_DAY_START_HOUR,
  shiftDayKey,
  workedByDay,
} from './shift-time';
import { PrismaService } from '../prisma/prisma.service';
import { shouldRecordPing } from '../analytics/track-math';
import { VehiclesService } from '../vehicles/vehicles.service';
import { OdometerReaderService } from '../vehicles/odometer-reader.service';
import { RealtimeService } from '../realtime/realtime.service';
import { ScheduleService } from '../attendance/schedule.service';
import {
  tashkentDateKey,
  tashkentDayStartUtc,
  tashkentMinutes,
  tashkentWeekday,
} from '../common/tashkent-time';

type DriverWithUser = Driver & {
  user: User;
  vehicle?: (Vehicle & { documents?: VehicleDocument[] }) | null;
  documents?: DriverDocument[];
  workLogs?: WorkLog[];
  homeDistrict?: { name: string } | null;
};

/** What a shift carried over, with the order number for display. */
/** How far back the admin's shift alerts look for closed shifts and carry-overs. */
const ALERT_WINDOW_MS = 24 * 3_600_000;

const WORK_LOG_INCLUDE = {
  carryOvers: { include: { order: { select: { orderNumber: true, clientName: true } } } },
  // Each break of the shift, for the admin (owner, 12.11.2026).
  breaks: { orderBy: { startedAt: 'asc' } },
} as const;
type WorkLogCarryOver = { orderId: string; reason: string; comment: string | null; order: { orderNumber: number; clientName: string } };

/** The pressable "not today" reasons, as the seller and admin will read them. */
const CARRY_OVER_LABEL_UZ: Record<CarryOverReason, string> = {
  customer_not_ready: 'Mijoz bugun qabul qila olmaydi',
  customer_unreachable: 'Mijoz javob bermayapti',
  cargo_not_ready: 'Yuk tayyor emas',
  vehicle_problem: 'Mashina nosoz',
  out_of_time: 'Ish vaqti tugadi',
  other: 'Boshqa sabab',
};

// Include only the driver's currently open shift (if any) so payloads can expose
// `shift_started_at` without loading the full history.
const DRIVER_INCLUDE = {
  // The lorry comes with its dated papers: the driver's own screen lists them.
  user: true,
  vehicle: { include: { documents: true } },
  documents: true,
  workLogs: { where: { clockOutAt: null }, take: 1 },
  homeDistrict: { select: { name: true } },
};

/** Days within which a document counts as "expiring soon". */
const EXPIRY_SOON_DAYS = 30;

const ZERO_TARIFF: VehicleTariff = {
  category: 'katta',
  daily_wage_som: 0,
  pickup_city_som: 0,
  pickup_outside_som: 0,
  delivery_city_som: 0,
  delivery_outside_som: 0,
  early_hour_som: 0,
};

/** UTC [from, to) range for a Tashkent calendar day or month. */
export function periodRange(period: EarningsPeriod): { from: Date; to: Date } {
  const now = new Date();
  const today = tashkentDateKey(now);
  if (period === 'today') {
    const from = tashkentDayStartUtc(today);
    return { from, to: new Date(from.getTime() + 86_400_000) };
  }
  const [year, month] = today.split('-').map(Number);
  const from = tashkentDayStartUtc(`${year}-${String(month).padStart(2, '0')}-01`);
  const nextMonth = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
  return {
    from,
    to: tashkentDayStartUtc(`${nextMonth}-01`),
  };
}

/** The bonus period he is in, the office's: from the 16th to the next 15th inclusive. */
export function bonusPeriodRange(now: Date = new Date()): { from: Date; to: Date } {
  const [y, m, d] = tashkentDateKey(now).split('-').map(Number) as [number, number, number];
  const start = new Date(Date.UTC(y, d >= 16 ? m - 1 : m - 2, 16)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(y, d >= 16 ? m : m - 1, 16)).toISOString().slice(0, 10);
  return { from: tashkentDayStartUtc(start), to: tashkentDayStartUtc(end) };
}

/** The newest paper of each kind, in a fixed order, as the driver's screen lists them. */
function latestPerType(
  docs: { type: string; issuedAt: Date | null; expiresAt: Date; holderName: string | null }[],
): DriverPublic['vehicle_documents'] {
  const order = ['texosmotr', 'gas_inspection', 'insurance', 'power_of_attorney', 'tint', 'advertising_permit', 'other'];
  const best = new Map<string, (typeof docs)[number]>();
  for (const d of docs) {
    const cur = best.get(d.type);
    if (!cur || d.expiresAt > cur.expiresAt) best.set(d.type, d);
  }
  return [...best.values()]
    .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))
    .map((d) => ({
      type: d.type as DriverPublic['vehicle_documents'][number]['type'],
      issued_at: d.issuedAt ? d.issuedAt.toISOString().slice(0, 10) : null,
      expires_at: d.expiresAt.toISOString().slice(0, 10),
      holder_name: d.holderName,
    }));
}

function docsExpiryAlert(docs: { expiresAt: Date }[] | undefined): 'expired' | 'soon' | null {
  if (!docs?.length) {
    return null;
  }
  const now = Date.now();
  const soonMs = EXPIRY_SOON_DAYS * 86_400_000;
  let alert: 'expired' | 'soon' | null = null;
  for (const d of docs) {
    const diff = d.expiresAt.getTime() - now;
    if (diff < 0) {
      return 'expired';
    }
    if (diff <= soonMs) {
      alert = 'soon';
    }
  }
  return alert;
}

/** Whole years since the licence was issued — what the office calls staj. */
function licenseYears(issuedAt: Date | null): number | null {
  if (!issuedAt) return null;
  const now = new Date();
  let years = now.getUTCFullYear() - issuedAt.getUTCFullYear();
  const beforeAnniversary =
    now.getUTCMonth() < issuedAt.getUTCMonth() ||
    (now.getUTCMonth() === issuedAt.getUTCMonth() && now.getUTCDate() < issuedAt.getUTCDate());
  if (beforeAnniversary) years -= 1;
  return Math.max(0, years);
}

/** Parse a YYYY-MM-DD string as a UTC date. */
function toDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

/** How an incident is named to the office. */
const INCIDENT_LABEL: Record<string, string> = {
  accident: 'Avariya',
  breakdown: 'Buzilish',
  damage: 'Shikastlanish',
  other: 'Hodisa',
};

/**
 * Speed from this fix and the one before, and whether he has left the spot he
 * stood on. Under 15 m is GPS drift, not driving; fixes under 5 s or over 2 min
 * apart say nothing about speed. Exported for tests.
 */
export function motionFrom(
  driver: {
    locationLat: number | null;
    locationLng: number | null;
    locationUpdatedAt: Date | null;
    anchorLat?: number | null;
    anchorLng?: number | null;
  },
  at: { lat: number; lng: number },
  now: Date,
): { locationSpeedKmh: number | null; anchorLat?: number; anchorLng?: number; movedAt?: Date } {
  let speed: number | null = null;
  if (driver.locationLat != null && driver.locationLng != null && driver.locationUpdatedAt) {
    const sec = (now.getTime() - driver.locationUpdatedAt.getTime()) / 1000;
    if (sec >= 5 && sec <= 120) {
      const m = metresBetween({ lat: driver.locationLat, lng: driver.locationLng }, at);
      const kmh = (m / sec) * 3.6;
      speed = m < 15 ? 0 : kmh > 160 ? null : Math.round(kmh);
    }
  }
  const left =
    driver.anchorLat == null ||
    driver.anchorLng == null ||
    metresBetween({ lat: driver.anchorLat, lng: driver.anchorLng }, at) >= 50;
  return { locationSpeedKmh: speed, ...(left ? { anchorLat: at.lat, anchorLng: at.lng, movedAt: now } : {}) };
}

/** How far into its work an order is: the furthest-in order is the one he is on. */
const ORDER_STAGE: string[] = [
  'assigned_to_driver',
  'driver_accepted',
  'collecting_items',
  'items_collected',
  'on_the_way',
  'arrived_at_customer',
  'returning',
];

type StopRow = { position: number; legStatus: string; lat: number | null; lng: number | null; returnRequired: boolean; returnedAt: Date | null };

/**
 * The next place an order sends its driver: the first pickup he has not
 * reached, then the client; on a return, the first stop still to take goods
 * back to. Exported for tests.
 */
export function nextTarget(o: {
  status: string;
  deliveryLat: number | null;
  deliveryLng: number | null;
  pickupSources: StopRow[];
}): { lat: number; lng: number } | null {
  const sorted = [...o.pickupSources].sort((a, b) => a.position - b.position);
  const at = (lat: number | null, lng: number | null) => (lat != null && lng != null ? { lat, lng } : null);
  switch (o.status) {
    case 'assigned_to_driver':
    case 'driver_accepted':
    case 'collecting_items': {
      const p = sorted.find((s) => s.legStatus !== 'arrived');
      return p ? at(p.lat, p.lng) : at(o.deliveryLat, o.deliveryLng);
    }
    case 'items_collected':
    case 'on_the_way':
    case 'arrived_at_customer':
      return at(o.deliveryLat, o.deliveryLng);
    case 'returning': {
      const r = sorted.find((s) => s.returnRequired && !s.returnedAt);
      return r ? at(r.lat, r.lng) : null;
    }
    default:
      return null;
  }
}

/** How far back a fix still says which way he is going. */
const HEADING_WINDOW_MS = 30 * 60_000;
const HEADING_MIN_METRES = 15;

/** Degrees clockwise from north, from one point to the next. Exported for tests. */
export function bearingDegrees(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
}

/** The location key as it is stored: SHA-256, hex. */
export function hashLocationKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

@Injectable()
export class DriversService {
  private readonly logger = new Logger(DriversService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly vehicles: VehiclesService,
    private readonly realtime: RealtimeService,
    private readonly schedule: ScheduleService,
    private readonly notifications: NotificationsService,
    private readonly odometerReader: OdometerReaderService,
  ) {}

  /** Driver logs their assigned vehicle's odometer (FR: mileage tracking). */
  async logMyKm(userId: string, km: number, photoUrl: string | null = null): Promise<KmRecordPublic> {
    const driver = await this.prisma.driver.findUnique({ where: { userId } });
    if (!driver) {
      throw new ForbiddenException('Only a driver can perform this action');
    }
    if (!driver.vehicleId) {
      throw new BadRequestException('no_vehicle_assigned');
    }
    // A driver's kilometres come with the odometer photo, always (owner,
    // 05.11.2026): the old card in Ma'lumotlarim took any number without one.
    if (!photoUrl) {
      throw new BadRequestException('odometer_photo_required');
    }
    // The photo and the typed number are both required, and taken as they
    // are: no AI reads the photo or holds the number against it (owner,
    // 05.11.2026 — it had been checked since 02.11). The office has the
    // photo beside the number if it wants to look.
    return this.vehicles.logKm(driver.vehicleId, km, userId, photoUrl, { aiKm: null, status: 'skipped' });
  }

  /**
   * Is the odometer asked for now? Once a week per lorry: until it has a
   * reading since this week's Monday 00:00 Tashkent (owner, 07.11.2026).
   */
  async myKmDue(userId: string, now: Date = new Date()): Promise<KmDue> {
    const driver = await this.prisma.driver.findUnique({
      where: { userId },
      select: { vehicleId: true, vehicle: { select: { currentKm: true } } },
    });
    if (!driver?.vehicleId) return { due: false, last_km: null };
    // Once a week, right after "Ishni boshladim": from Monday until this week's
    // reading is in — a Monday missed is asked on Tuesday, Wednesday… (owner,
    // 30.10.2026; 07.11.2026).
    const sinceMonday = (tashkentWeekday(now) + 6) % 7;
    const mondayStart = new Date(tashkentDayStartUtc(tashkentDateKey(now)).getTime() - sinceMonday * 86_400_000);
    const today = await this.prisma.kmRecord.findFirst({
      where: { vehicleId: driver.vehicleId, recordedAt: { gte: mondayStart } },
      select: { id: true },
    });
    return { due: !today, last_km: driver.vehicle?.currentKm ?? null };
  }

  /** Driver reports an incident for their assigned vehicle (optionally tied to an order). */
  async reportIncident(userId: string, input: ReportIncidentInput): Promise<IncidentPublic> {
    const driver = await this.prisma.driver.findUnique({ where: { userId } });
    if (!driver) {
      throw new ForbiddenException('Only a driver can perform this action');
    }
    if (!driver.vehicleId) {
      throw new BadRequestException('no_vehicle_assigned');
    }
    const incident = await this.vehicles.addIncident(
      driver.vehicleId,
      { type: input.type, description: input.description, order_id: input.order_id },
      userId,
    );
    // The office hears of it on the site at once, not only when someone opens
    // the lorry's page (owner, 30.10.2026). A failure here never loses the report.
    try {
      const [who, staff] = await Promise.all([
        this.prisma.driver.findUnique({
          where: { id: driver.id },
          select: { user: { select: { name: true } }, vehicle: { select: { plateNumber: true } } },
        }),
        this.prisma.user.findMany({ where: { role: { in: ['admin', 'manager'] }, status: 'active' }, select: { id: true } }),
      ]);
      const kind = INCIDENT_LABEL[input.type] ?? input.type;
      const plate = who?.vehicle?.plateNumber ? ` (${who.vehicle.plateNumber})` : '';
      await this.notifications.notifyMany(
        staff.map((u) => u.id),
        {
          type: 'vehicle.incident',
          title: `${kind}: ${who?.user.name ?? 'Haydovchi'}${plate}`,
          body: input.description?.trim() || kind,
          relatedOrderId: input.order_id ?? null,
        },
      );
    } catch (err) {
      this.logger.error(`incident notice failed: ${(err as Error).message}`);
    }
    return incident;
  }

  /** Creates a driver account: a User (role=driver) plus its Driver profile. */
  async create(input: CreateDriverInput): Promise<DriverPublic> {
    const existing = await this.prisma.user.findUnique({
      where: { phoneNumber: input.phone_number },
    });
    if (existing) {
      throw new ConflictException('phone_already_registered');
    }
    if (input.vehicle_id) {
      await this.assertVehicleAssignable(input.vehicle_id);
    }
    const passwordHash = await bcrypt.hash(input.password, 10);
    const driver = await this.prisma.driver.create({
      data: {
        vehicleInfo: input.vehicle_info,
        ...(input.vehicle_id ? { vehicle: { connect: { id: input.vehicle_id } } } : {}),
        ...(input.birth_date ? { birthDate: new Date(`${input.birth_date}T00:00:00.000Z`) } : {}),
        ...(input.license_category ? { licenseCategory: input.license_category } : {}),
        ...(input.license_issued_at ? { licenseIssuedAt: new Date(`${input.license_issued_at}T00:00:00.000Z`) } : {}),
        ...(input.license_expires_at ? { licenseExpiresAt: new Date(`${input.license_expires_at}T00:00:00.000Z`) } : {}),
        ...(input.home_district_code
          ? { homeDistrict: { connect: { code: input.home_district_code } } }
          : {}),
        user: {
          create: {
            name: input.name,
            phoneNumber: input.phone_number,
            passwordHash,
            role: 'driver',
          },
        },
      },
      include: DRIVER_INCLUDE,
    });
    return this.toPublic(driver);
  }

  /** Working drivers; `inactive` lists the ones let go (Ishdan bo'shatilganlar). */
  async findAll(search?: string, status: 'active' | 'inactive' = 'active'): Promise<DriverPublic[]> {
    const q = search?.trim();
    const drivers = await this.prisma.driver.findMany({
      where: {
        user: { status },
        ...(q
          ? {
              OR: [
                { user: { name: { contains: q, mode: 'insensitive' } } },
                { user: { phoneNumber: { contains: q, mode: 'insensitive' } } },
                { vehicleInfo: { contains: q, mode: 'insensitive' } },
                { vehicle: { plateNumber: { contains: q, mode: 'insensitive' } } },
                { vehicle: { model: { contains: q, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: DRIVER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return drivers.map((d) => this.toPublic(d));
  }

  async findOne(id: string): Promise<DriverPublic> {
    return this.toPublic(await this.getOrThrow(id));
  }

  /** Driver self ("Ma'lumotlarim"): profile + the pay tariff for their vehicle class. */
  async findByUserId(userId: string): Promise<DriverMe> {
    const driver = await this.prisma.driver.findUnique({
      where: { userId },
      include: DRIVER_INCLUDE,
    });
    if (!driver) throw new NotFoundException('Driver profile not found');
    const tariff = driver.vehicle?.category
      ? await this.tariffFor(driver.vehicle.category as VehicleCategory)
      : null;
    const open = driver.workLogs?.[0];
    const shift_end_check =
      open && open.endCheckRanAt
        ? {
            awaiting_answer: isAwaitingAnswer(open),
            asked_at: isAwaitingAnswer(open) ? open.endCheckSentAt!.toISOString() : null,
            unanswered: open.endCheckUnanswered,
            zone: (open.endCheckZone as 'tashkent' | 'viloyat' | 'unknown' | null) ?? null,
            shift_end: open.expectedEnd,
            // The last of the three asks: when it closes by itself (owner, 07.11.2026).
            closes_at:
              isAwaitingAnswer(open) && open.endCheckUnanswered >= END_CHECK_MAX_UNANSWERED - 1
                ? new Date(open.endCheckSentAt!.getTime() + CLOSE_AFTER_LAST_MIN * 60_000).toISOString()
                : null,
          }
        : null;
    const gps = await this.gpsWindows(driver.id, !!open);
    return { ...this.toPublic(driver), tariff, shift_end_check, ...gps };
  }

  /** The window in which GPS must be on — see gps-window.ts. */
  async gpsRequired(driverId: string, onShift: boolean, now: Date = new Date()): Promise<{ from: string; until: string } | null> {
    return (await this.gpsWindows(driverId, onShift, now)).gps_required;
  }

  /**
   * Both windows (owner, 12.11.2026): `gps_required` — GPS, internet and battery
   * saver watched; `gps_only` — on a break, GPS alone (APK 1.4.2+; older ones
   * ask nothing then).
   */
  async gpsWindows(
    driverId: string,
    onShift: boolean,
    now: Date = new Date(),
  ): Promise<{ gps_required: { from: string; until: string } | null; gps_only: { from: string; until: string } | null }> {
    if (!onShift) return { gps_required: null, gps_only: null };
    // An order offered counts too (owner, 07.11.2026): started again in the evening for an
    // order not yet taken, GPS, internet and battery saver are watched from that moment.
    const inHand = (await ordersInHand(this.prisma, driverId, BLOCKING_ACTIVE_ORDER_STATUSES, { now })).length > 0;
    const day = inHand ? null : await this.schedule.effectiveDay(driverId, tashkentWeekday(now));
    const brk = await this.prisma.driver.findUnique({ where: { id: driverId }, select: { breakStartedAt: true, breakUntil: true } });
    const input = { now, onShift, inHand, day, breakStartedAt: brk?.breakStartedAt ?? null, breakUntil: brk?.breakUntil ?? null };
    const iso = (w: { from: Date; until: Date } | null) => (w ? { from: w.from.toISOString(), until: w.until.toISOString() } : null);
    return { gps_required: iso(gpsWindow(input)), gps_only: iso(gpsOnlyWindow(input)) };
  }

  /** The driver's salary breakdown ("Maosh va bonuslar") for a period. */
  async getMyEarnings(userId: string, period: EarningsPeriod): Promise<DriverEarnings> {
    const driver = await this.prisma.driver.findUnique({
      where: { userId },
      include: {
        vehicle: { select: { category: true } },
        workLogs: {
          where: { clockOutAt: null },
          take: 1,
          select: { clockInAt: true },
        },
      },
    });
    if (!driver) throw new NotFoundException('Driver profile not found');

    // What the driver is shown is what the office's Ish haqi shows: the pickup
    // and delivery bonuses and the extra hours, for the same 16th-to-15th period
    // (owner, 02.11.2026). The daily wage is settled in person; fines come later.
    const { from, to } = period === 'month' ? bonusPeriodRange() : periodRange(period);
    const tariff = driver.vehicle?.category
      ? await this.tariffFor(driver.vehicle.category as VehicleCategory)
      : ZERO_TARIFF;

    // Pickup/delivery pay is recorded at the moment each paid action happens.
    // Reading the ledger also preserves the exact tariff that applied at that time.
    const tariffEarnings = await this.prisma.driverTariffEarning.groupBy({
      by: ['type'],
      where: {
        driverId: driver.id,
        earnedAt: { gte: from, lt: to },
      },
      _count: { _all: true },
      _sum: { amount: true },
    });

    const tariffLine = (
      type: Exclude<EarningsLine['type'], 'daily_wage'>,
      fallbackUnit: number,
    ): EarningsLine => {
      const earning = tariffEarnings.find((entry) => entry.type === type);
      const count = earning?._count._all ?? 0;
      const amount = earning?._sum.amount ?? 0;
      return {
        type,
        count,
        unit_price_som: count > 0 ? Math.round(amount / count) : fallbackUnit,
        amount_som: amount,
      };
    };
    const lines: EarningsLine[] = [
      tariffLine('pickup_city', tariff.pickup_city_som),
      tariffLine('pickup_outside', tariff.pickup_outside_som),
      tariffLine('delivery_city', tariff.delivery_city_som),
      tariffLine('delivery_outside', tariff.delivery_outside_som),
    ];
    // Mornings started before 09:00, by the minute. Shown only when there is some.
    const early = await this.prisma.morningStart.aggregate({
      where: { driverId: driver.id, status: 'confirmed', earlyMinutes: { gt: 0 }, pressedAt: { gte: from, lt: to } },
      _sum: { earlyMinutes: true, amountSom: true },
    });
    const earlyMin = early._sum.earlyMinutes ?? 0;
    if (earlyMin > 0) {
      lines.push({
        type: 'early_start',
        count: earlyMin,
        unit_price_som: tariff.early_hour_som,
        amount_som: early._sum.amountSom ?? 0,
      });
    }
    // Evenings past the end of the day, to the last photo. Shown only when there is some.
    const evening = await this.prisma.eveningOvertime.aggregate({
      where: { driverId: driver.id, lastPhotoAt: { gte: from, lt: to } },
      _sum: { minutes: true, amountSom: true },
    });
    const eveningMin = evening._sum.minutes ?? 0;
    if (eveningMin > 0) {
      lines.push({
        type: 'evening_overtime',
        count: eveningMin,
        unit_price_som: tariff.early_hour_som,
        amount_som: evening._sum.amountSom ?? 0,
      });
    }
    const total = lines.reduce((sum, l) => sum + l.amount_som, 0);
    return { period, from: from.toISOString(), to: to.toISOString(), lines, total_som: total };
  }

  private async tariffFor(category: VehicleCategory): Promise<VehicleTariff> {
    const row = await this.prisma.vehicleTariff.findUnique({ where: { category } });
    if (!row) return { ...ZERO_TARIFF, category };
    return {
      category: row.category as VehicleCategory,
      daily_wage_som: row.dailyWageSom,
      pickup_city_som: row.pickupCitySom,
      pickup_outside_som: row.pickupOutsideSom,
      delivery_city_som: row.deliveryCitySom,
      delivery_outside_som: row.deliveryOutsideSom,
      early_hour_som: row.earlyHourSom,
    };
  }

  async updateProfile(id: string, input: UpdateDriverInput): Promise<DriverPublic> {
    const current = await this.getOrThrow(id);
    if (input.vehicle_id) {
      await this.assertVehicleAssignable(input.vehicle_id, id);
    }
    if (input.phone_number && input.phone_number !== current.user.phoneNumber) {
      const existing = await this.prisma.user.findUnique({
        where: { phoneNumber: input.phone_number },
      });
      if (existing) {
        throw new ConflictException('phone_already_registered');
      }
    }
    const userData = {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.phone_number !== undefined && { phoneNumber: input.phone_number }),
      ...(input.password ? { passwordHash: await bcrypt.hash(input.password, 10) } : {}),
      ...(input.telegram_id !== undefined && { telegramId: input.telegram_id }),
    };
    const driver = await this.prisma.driver.update({
      where: { id },
      data: {
        ...(input.vehicle_info !== undefined && { vehicleInfo: input.vehicle_info }),
        ...(input.vehicle_id !== undefined && {
          vehicle: input.vehicle_id ? { connect: { id: input.vehicle_id } } : { disconnect: true },
        }),
        ...(input.birth_date !== undefined && {
          birthDate: input.birth_date ? new Date(`${input.birth_date}T00:00:00.000Z`) : null,
        }),
        ...(input.license_category !== undefined && {
          licenseCategory: input.license_category || null,
        }),
        ...(input.license_issued_at !== undefined && {
          licenseIssuedAt: input.license_issued_at ? new Date(`${input.license_issued_at}T00:00:00.000Z`) : null,
        }),
        ...(input.license_expires_at !== undefined && {
          licenseExpiresAt: input.license_expires_at ? new Date(`${input.license_expires_at}T00:00:00.000Z`) : null,
        }),
        ...(input.home_district_code !== undefined && {
          homeDistrict: input.home_district_code
            ? { connect: { code: input.home_district_code } }
            : { disconnect: true },
        }),
        ...(Object.keys(userData).length > 0 && { user: { update: userData } }),
      },
      include: DRIVER_INCLUDE,
    });
    return this.toPublic(driver);
  }

  async updateLocation(
    userId: string,
    input: UpdateDriverLocationInput,
  ): Promise<{ on_shift: boolean; gps_required: { from: string; until: string } | null; gps_only?: { from: string; until: string } | null }> {
    const driver = await this.prisma.driver.findUnique({ where: { userId } });
    if (!driver) throw new NotFoundException('Driver profile not found');
    const now = new Date();
    // The trail for the office's route map keeps a fix only when it says
    // something new: the truck moved, or a minute passed while it stood.
    //
    // Measured against the last fix KEPT, not the last one received. The
    // driver's row is overwritten by every ping — fifteen seconds apart — so
    // comparing against it meant the minute never elapsed and the thirty
    // metres were measured over fifteen seconds of driving. The office got one
    // point per shift and no line on the map.
    const lastKept = await this.prisma.driverLocationPing.findFirst({
      where: { driverId: driver.id },
      orderBy: { recordedAt: 'desc' },
      select: { lat: true, lng: true, recordedAt: true },
    });
    const previous = lastKept
      ? { lat: lastKept.lat, lng: lastKept.lng, at: lastKept.recordedAt }
      : null;
    // On a break too the position is kept (owner, 12.11.2026, later): that is
    // why GPS must stay on then.
    await this.prisma.driver.update({
      where: { id: driver.id },
      data: {
        locationLat: input.lat,
        locationLng: input.lng,
        locationUpdatedAt: now,
        ...motionFrom(driver, input, now),
      },
    });
    if (shouldRecordPing(previous, input, now)) {
      await this.prisma.driverLocationPing.create({
        data: { driverId: driver.id, lat: input.lat, lng: input.lng, recordedAt: now },
      });
    }
    // The phone's background service stops itself on false: a shift closed from
    // elsewhere must not leave him tracked with the app shut.
    const open = await this.prisma.workLog.count({ where: { driverId: driver.id, clockOutAt: null } });
    return { on_shift: open > 0, ...(await this.gpsWindows(driver.id, open > 0, now)) };
  }

  /**
   * Fixes the phone kept without internet, each at the moment it was taken
   * (owner, 04.11.2026). They go on the trail as they were; the driver's
   * position moves only if the newest of them is newer than what we have.
   * Times in the future or older than two days are dropped.
   */
  async updateLocationBatch(
    userId: string,
    input: DriverLocationBatchInput,
  ): Promise<{ on_shift: boolean; kept: number; gps_required: { from: string; until: string } | null; gps_only?: { from: string; until: string } | null; break_until?: string | null }> {
    const driver = await this.prisma.driver.findUnique({ where: { userId } });
    if (!driver) throw new NotFoundException('Driver profile not found');
    return this.applyLocationBatch(driver, input);
  }

  /**
   * A key for the phone's own location service (owner, 05.11.2026): it runs
   * with the app closed and the phone asleep, outside the app's login, and
   * sends with this instead. A new one replaces the old; only its hash is kept.
   */
  async issueLocationKey(userId: string): Promise<{ key: string }> {
    const driver = await this.prisma.driver.findUnique({ where: { userId }, select: { id: true } });
    if (!driver) throw new NotFoundException('Driver profile not found');
    const key = randomBytes(32).toString('hex');
    await this.prisma.driver.update({ where: { id: driver.id }, data: { locationKeyHash: hashLocationKey(key) } });
    return { key };
  }

  /** Positions from the phone's own service, by its key. A wrong key, or a driver no longer active, is refused. */
  async ingestLocationByKey(
    key: string | undefined,
    input: DriverLocationBatchInput,
  ): Promise<{ on_shift: boolean; kept: number; gps_required: { from: string; until: string } | null; gps_only?: { from: string; until: string } | null; break_until?: string | null }> {
    if (!key || key.length < 32) throw new UnauthorizedException('location_key_invalid');
    const driver = await this.prisma.driver.findUnique({
      where: { locationKeyHash: hashLocationKey(key) },
      include: { user: { select: { status: true } } },
    });
    if (!driver || driver.user.status !== 'active') throw new UnauthorizedException('location_key_invalid');
    return this.applyLocationBatch(driver, input);
  }

  private async applyLocationBatch(
    driver: { id: string; locationUpdatedAt: Date | null; breakStartedAt?: Date | null; breakUntil?: Date | null },
    input: DriverLocationBatchInput,
  ): Promise<{ on_shift: boolean; kept: number; gps_required: { from: string; until: string } | null; gps_only?: { from: string; until: string } | null; break_until?: string | null }> {
    const now = new Date();
    const skew = clockSkewMs(input.sent_at, now);
    const points = input.points
      .map((p) => ({ lat: p.lat, lng: p.lng, at: new Date(new Date(p.recorded_at).getTime() + skew) }))
      .filter((p) => p.at.getTime() <= now.getTime() + 60_000 && p.at.getTime() >= now.getTime() - 2 * 86_400_000)
      .map((p) => ({ ...p, at: p.at.getTime() > now.getTime() ? now : p.at }))
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    let previous: { lat: number; lng: number; at: Date } | null = null;
    const rows: { driverId: string; lat: number; lng: number; recordedAt: Date }[] = [];
    for (const p of points) {
      if (shouldRecordPing(previous, p, p.at)) {
        rows.push({ driverId: driver.id, lat: p.lat, lng: p.lng, recordedAt: p.at });
        previous = p;
      }
    }
    if (rows.length) await this.prisma.driverLocationPing.createMany({ data: rows });
    if (rows.length) await this.reconsiderClosedShifts(driver.id, rows.map((r) => r.recordedAt), now);
    const newest = points[points.length - 1];
    if (newest && (!driver.locationUpdatedAt || newest.at.getTime() > driver.locationUpdatedAt.getTime())) {
      await this.prisma.driver.update({
        where: { id: driver.id },
        data: { locationLat: newest.lat, locationLng: newest.lng, locationUpdatedAt: newest.at },
      });
    }
    const open = await this.prisma.workLog.count({ where: { driverId: driver.id, clockOutAt: null } });
    return {
      on_shift: open > 0,
      kept: rows.length,
      ...(await this.gpsWindows(driver.id, open > 0, now)),
      // For the red screen's "extend the break" on the phone (owner, 12.11.2026).
      break_until: driver.breakUntil?.toISOString() ?? null,
    };
  }

  /**
   * Positions that reached the server late — kept on the phone with no
   * internet — and fall inside a shift already closed (owner, 05.11.2026): its
   * evening extra was worked out without them, so it is worked out again. The
   * last three days only, as the evening extra itself looks no further.
   */
  private async reconsiderClosedShifts(driverId: string, times: Date[], now: Date): Promise<void> {
    const earliest = Math.min(...times.map((t) => t.getTime()));
    const closed = await this.prisma.workLog.findMany({
      where: {
        driverId,
        eveningCheckedAt: { not: null },
        clockOutAt: { not: null, gte: new Date(now.getTime() - 3 * 86_400_000) },
        clockInAt: { lte: new Date(Math.max(...times.map((t) => t.getTime()))) },
      },
      select: { id: true, clockInAt: true, clockOutAt: true, closeSource: true, endCheckRanAt: true },
    });
    for (const log of closed) {
      const end = (
        log.closeSource === 'auto_stale' && log.endCheckRanAt && log.endCheckRanAt > log.clockOutAt! ? log.endCheckRanAt : log.clockOutAt!
      ).getTime();
      const inside = times.some((t) => t.getTime() >= log.clockInAt.getTime() && t.getTime() <= end);
      if (!inside || end < earliest - 1) continue;
      // Its period is paid and locked: the evening extra stays (owner, 07.11.2026).
      if (isPayDayLocked(log.clockInAt, now)) continue;
      await this.prisma.$transaction([
        this.prisma.eveningOvertime.deleteMany({ where: { workLogId: log.id } }),
        this.prisma.workLog.update({ where: { id: log.id }, data: { eveningCheckedAt: null } }),
      ]);
      this.logger.log(`late positions for shift ${log.id}: evening extra to be worked out again`);
    }
  }

  async findAllLocations(): Promise<DriverLocationPublic[]> {
    const [drivers, stations] = await Promise.all([
      this.prisma.driver.findMany({
        include: {
          user: { select: { name: true, status: true } },
          vehicle: { select: { plateNumber: true, model: true } },
        },
        where: { user: { status: 'active' } },
      }),
      // The fences, read fresh: a lorry inside one is at that pump, and the
      // office sees it while it is happening rather than in a report later.
      this.prisma.fuelStation.findMany({
        where: { active: true, lat: { not: null }, lng: { not: null } },
        select: { name: true, lat: true, lng: true },
      }),
    ]);
    const now = Date.now();
    // The last two kept fixes per driver, recent ones only, for his heading.
    const pings = await this.prisma.driverLocationPing.findMany({
      where: { driverId: { in: drivers.map((d) => d.id) }, recordedAt: { gte: new Date(now - HEADING_WINDOW_MS) } },
      orderBy: { recordedAt: 'desc' },
      select: { driverId: true, lat: true, lng: true },
    });
    const lastTwo = new Map<string, { lat: number; lng: number }[]>();
    for (const p of pings) {
      const list = lastTwo.get(p.driverId) ?? [];
      if (list.length < 2) list.push({ lat: p.lat, lng: p.lng });
      lastTwo.set(p.driverId, list);
    }
    // Where each driver has to go next: the lorry faces it on the map (owner,
    // 30.10.2026). Without work it faces the way it last drove.
    const working = await this.prisma.order.findMany({
      where: { assignedDriverId: { in: drivers.map((d) => d.id) }, status: { in: [...ACTIVE_ORDER_STATUSES] } },
      select: {
        assignedDriverId: true,
        status: true,
        deliveryLat: true,
        deliveryLng: true,
        pickupSources: {
          select: { position: true, legStatus: true, lat: true, lng: true, returnRequired: true, returnedAt: true },
        },
      },
    });
    const targetOf = new Map<string, { lat: number; lng: number }>();
    const leadStage = new Map<string, number>();
    for (const o of working) {
      const id = o.assignedDriverId!;
      const st = ORDER_STAGE.indexOf(o.status);
      if (st <= (leadStage.get(id) ?? -1)) continue;
      const t = nextTarget(o);
      if (!t) continue;
      leadStage.set(id, st);
      targetOf.set(id, t);
    }
    const headingOf = (id: string, at: { lat: number; lng: number } | null): number | null => {
      const target = targetOf.get(id);
      if (target && at && metresBetween(at, target) >= HEADING_MIN_METRES) return bearingDegrees(at, target);
      const [cur, prev] = lastTwo.get(id) ?? [];
      // Under a few metres apart is GPS drift, not driving.
      if (!cur || !prev || metresBetween(prev, cur) < HEADING_MIN_METRES) return null;
      return bearingDegrees(prev, cur);
    };
    const atStation = (d: { locationLat: number | null; locationLng: number | null; locationUpdatedAt: Date | null }) => {
      if (d.locationLat == null || d.locationLng == null || !d.locationUpdatedAt) return null;
      // An old fix says where the phone was, not where it is.
      if (now - d.locationUpdatedAt.getTime() > FUEL_GPS_STALE_MS) return null;
      const here = { lat: d.locationLat, lng: d.locationLng };
      const inside = stations
        .map((s) => ({ name: s.name, m: metresBetween(here, { lat: s.lat!, lng: s.lng! }) }))
        .filter((s) => s.m <= FUEL_STATION_FENCE_RADIUS_M)
        .sort((a, b) => a.m - b.m)[0];
      return inside?.name ?? null;
    };
    return drivers.map((d) => ({
      id: d.id,
      name: d.user.name,
      current_status: d.currentStatus as DriverStatus,
      lat: d.locationLat,
      lng: d.locationLng,
      location_updated_at: d.locationUpdatedAt?.toISOString() ?? null,
      speed_kmh: d.locationSpeedKmh ?? null,
      moved_at: d.movedAt?.toISOString() ?? null,
      vehicle_plate: d.vehicle?.plateNumber ?? null,
      vehicle_model: d.vehicle?.model ?? null,
      at_fuel_station: atStation(d),
      heading: headingOf(d.id, d.locationLat != null && d.locationLng != null ? { lat: d.locationLat, lng: d.locationLng } : null),
    }));
  }

  async remove(id: string): Promise<{ deleted: true }> {
    const driver = await this.getOrThrow(id);

    // Driver assignments are operational history and deliberately restrict a
    // physical delete. Keep that history, but do not let an active delivery
    // disappear from the boards halfway through its workflow.
    const activeOrders = await this.prisma.order.count({
      where: { assignedDriverId: id, status: { in: [...ACTIVE_ORDER_STATUSES] } },
    });
    if (activeOrders > 0) {
      throw new ConflictException('driver_has_active_order');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.driver.update({
        where: { id },
        data: {
          currentStatus: 'offline',
          vehicle: { disconnect: true },
          breakUntil: null,
        },
      });
      await tx.user.update({
        where: { id: driver.userId },
        data: { status: 'inactive' },
      });
    });
    forgetAccount(driver.userId); // out at once, not in 20 s
    this.realtime.driverStatusChanged(id, 'offline');
    return { deleted: true };
  }

  /** Take a driver who was let go back on: he can sign in again. His lorry is
   *  given back on his page, as for a new driver. */
  async rehire(id: string): Promise<DriverPublic> {
    const driver = await this.getOrThrow(id);
    await this.prisma.user.update({ where: { id: driver.userId }, data: { status: 'active' } });
    forgetAccount(driver.userId);
    return this.findOne(id);
  }

  /**
   * The drivers on shift whose Ertangi booking has just opened (00:01 on its
   * day) are busy from now, not from their first pickup. Run every minute by
   * DriverStatusDispatcher; a driver who is offline is picked up by clock-in.
   */
  async settleOpenedBookings(now: Date = new Date()): Promise<number> {
    const candidates = await this.prisma.driver.findMany({
      where: {
        currentStatus: 'available',
        ordersAssigned: { some: { bookingKind: { not: null }, status: { in: [...BLOCKING_ACTIVE_ORDER_STATUSES] } } },
      },
      select: { id: true },
    });
    let changed = 0;
    for (const { id } of candidates) {
      const r = await settleDriverStatus(this.prisma, id, { now });
      if (r.changed) {
        changed++;
        this.realtime.driverStatusChanged(id, r.status);
      }
    }
    return changed;
  }

  // --- Work shifts (clock in/out) ---

  /**
   * Start a work shift: opens a WorkLog and brings an offline driver online.
   *
   * Lateness is computed here, against the driver's effective schedule in
   * Tashkent time — never taken from the client, whose clock the driver
   * controls and whose settings may not have loaded. A late arrival without a
   * reason is rejected, so the prompt cannot be skipped.
   */
  async clockIn(userId: string, input: ClockInInput = {}): Promise<WorkLogPublic> {
    const driver = await this.getDriverByUserIdOrThrow(userId);
    const open = await this.prisma.workLog.findFirst({
      where: { driverId: driver.id, clockOutAt: null },
    });
    if (open) {
      throw new ConflictException('shift_already_open');
    }

    const now = new Date();
    // Started again the same day — an order given after his shift was closed —
    // is the same shift carrying on, not a second one; a new shift begins at
    // 05:00 (owner, 04.11.2026; 07.11.2026).
    const reopened = await this.reopenTodaysShift(driver, now);
    if (reopened) return reopened;

    const day = await this.schedule.effectiveDay(driver.id, tashkentWeekday(now));
    // Only the day's first clock-in can be late — returning from lunch is not a
    // second late arrival. An early order done and closed before the work day
    // began (04:30–06:00) does not count: the 09:00 start is still judged
    // (owner, 09.11.2026).
    const todayStart = tashkentDayStartUtc(tashkentDateKey(now));
    const workStart = new Date(todayStart.getTime() + day.startMinutes * 60_000);
    const earlierToday = await this.prisma.workLog.count({
      where: {
        driverId: driver.id,
        clockInAt: { gte: todayStart },
        OR: [{ clockOutAt: null }, { clockOutAt: { gte: workStart } }],
      },
    });
    const grace = await this.schedule.graceMinutes();
    // A day of leave the office granted: he is asked once whether he means to
    // work, and if he does he is never late — he was not due at all
    // (owner, 30.10.2026).
    const todayLabel = new Date(`${tashkentDateKey(now)}T00:00:00.000Z`);
    const onLeave = await this.prisma.leaveRequest.count({
      where: { driverId: driver.id, status: 'approved', startDate: { lte: todayLabel }, endDate: { gte: todayLabel } },
    });
    if (onLeave > 0 && earlierToday === 0 && !input.on_leave_ok) {
      throw new BadRequestException('on_leave_today');
    }
    // Minutes past the scheduled start; the grace period only decides whether
    // that counts as late, it is not subtracted from what we record.
    const pastStart = tashkentMinutes(now) - day.startMinutes;
    const isLate = !day.isDayOff && onLeave === 0 && earlierToday === 0 && pastStart > grace;
    const reason = input.late_reason?.trim() || null;
    if (isLate && !reason) {
      throw new BadRequestException('late_reason_required');
    }

    const log = await this.prisma
      .$transaction(async (tx) => {
        const created = await tx.workLog.create({
          data: {
            driverId: driver.id,
            lateReason: isLate ? reason : null,
            isLate,
            lateMinutes: isLate ? pastStart : 0,
            expectedStart: day.isDayOff ? null : day.startTime,
            expectedEnd: day.isDayOff ? null : day.endTime,
          },
        });
        // Coming on shift brings an offline driver back as whatever his orders
        // say — busy if he still carries yesterday's load or today's booking has
        // opened, available only when he truly has nothing. It used to be
        // available, full stop, which is how an unfinished order turned Bo'sh
        // the next morning. A driver already busy / on_delivery is left alone.
        const settled =
          driver.currentStatus === 'offline'
            ? await settleDriverStatus(tx, driver.id, { comingOnShift: true })
            : { status: driver.currentStatus, changed: false };
        return { created, settled };
      })
      .catch((err: unknown) => {
        // Two taps at once both passed the check above; the partial unique
        // index (one open shift per driver) lets only the first one in.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException('shift_already_open');
        }
        throw err;
      });
    if (log.settled.changed) this.realtime.driverStatusChanged(driver.id, log.settled.status);
    return this.workLogToPublic(log.created);
  }

  /**
   * The shift closed earlier in this shift day (05:00 to 05:00), or begun earlier
   * this calendar day, opened again. The time he was off counts as a break, so
   * worked hours stay what he worked, and is kept in offPeriods for the evening extra;
   * whatever closing it settled — the early leave, the evening extra — is
   * undone, to be settled again when it closes. Null when there is none.
   */
  private async reopenTodaysShift(
    driver: { id: string; currentStatus: string },
    now: Date,
  ): Promise<WorkLogPublic | null> {
    const last = await this.prisma.workLog.findFirst({
      where: { driverId: driver.id, clockOutAt: { not: null } },
      orderBy: { clockInAt: 'desc' },
    });
    if (!last?.clockOutAt) return null;
    // Today's shift: the same shift day (05:00–05:00), or — from 05:00 — begun
    // earlier this calendar day, e.g. at 04:30, which keys to yesterday; else
    // a 20:00 start needed no order (owner, 07.11.2026).
    const sameShiftDay = shiftDayKey(last.clockInAt) === shiftDayKey(now);
    const startedToday =
      tashkentDateKey(last.clockInAt) === tashkentDateKey(now) && tashkentMinutes(now) >= SHIFT_DAY_START_HOUR * 60;
    if (!sameShiftDay && !startedToday) return null;
    // Ended before that day's work start (an early order, 04:30–06:00): it
    // stays closed and paid as it is, and a later start is a new shift with
    // no order needed (owner, 07.11.2026).
    const endedOn = tashkentDateKey(last.clockOutAt);
    const workStart = (await this.schedule.effectiveDay(driver.id, tashkentWeekday(last.clockOutAt))).startMinutes;
    if (last.clockOutAt.getTime() < tashkentDayStartUtc(endedOn).getTime() + workStart * 60_000) return null;
    // Only for an order (owner, 07.11.2026): a driver who ended his day and went
    // home starts again because an order came to him, not to run up hours.
    if ((await ordersInHand(this.prisma, driver.id, BLOCKING_ACTIVE_ORDER_STATUSES, { now })).length === 0) {
      throw new BadRequestException('shift_closed_no_order');
    }
    // Reopen only the same calendar day, or the night after it (00:00–02:59).
    // At 03:00–05:00 with an order — an Ertangi booking opens at 00:01 — the
    // shift day is still yesterday's, but reopening it booked the whole night as
    // a break and the evening extra ran ~23 h: a new shift starts instead
    // (audit, 07.11.2026).
    const sameCalendarDay = tashkentDateKey(last.clockInAt) === tashkentDateKey(now);
    if (!sameCalendarDay && tashkentMinutes(now) >= 3 * 60) return null;
    // A shift in a paid, locked period is never reopened (owner, 07.11.2026).
    if (isPayDayLocked(last.clockInAt, now)) return null;
    const offFrom = last.clockOutAt;
    const offMinutes = Math.max(0, Math.round((now.getTime() - offFrom.getTime()) / 60_000));
    const result = await this.prisma
      .$transaction(async (tx) => {
        const { count } = await tx.workLog.updateMany({
          where: { id: last.id, clockOutAt: { not: null } },
          data: {
            clockOutAt: null,
            closeSource: null,
            autoClosed: false,
            isEarlyLeave: false,
            earlyMinutes: 0,
            earlyLeaveReason: null,
            // Back at work: no longer a day off (owner, 12.11.2026).
            dayOff: false,
            breakMinutes: { increment: offMinutes },
            // Kept with its times so it is not paid as evening extra (owner, 07.11.2026).
            offPeriods: [
              ...readOffPeriods(last.offPeriods).map((p) => ({ from: p.from.toISOString(), to: p.to.toISOString() })),
              { from: offFrom.toISOString(), to: now.toISOString() },
            ],
            // The evening check starts afresh from now: next look in half an hour.
            endCheckRanAt: now,
            endCheckZone: null,
            endCheckSentAt: null,
            endCheckAnsweredAt: null,
            endCheckUnanswered: 0,
            eveningCheckedAt: null,
          },
        });
        if (count === 0) return null;
        await tx.eveningOvertime.deleteMany({ where: { workLogId: last.id } });
        const reopenedLog = await tx.workLog.findUniqueOrThrow({ where: { id: last.id } });
        const settled =
          driver.currentStatus === 'offline'
            ? await settleDriverStatus(tx, driver.id, { comingOnShift: true })
            : { status: driver.currentStatus, changed: false };
        return { reopenedLog, settled };
      })
      .catch((err: unknown) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException('shift_already_open');
        }
        throw err;
      });
    if (!result) return null;
    if (result.settled.changed) this.realtime.driverStatusChanged(driver.id, result.settled.status);
    this.logger.log(`reopened shift ${last.id} (off ${offMinutes} min)`);
    return this.workLogToPublic(result.reopenedLog);
  }

  /** Finish the open work shift and take the driver offline. Blocked mid-delivery. */
  async clockOut(
    userId: string,
    input: ClockOutInput = {},
    source: 'driver' | 'end_check_stop' = 'driver',
  ): Promise<WorkLogPublic> {
    const driver = await this.getDriverByUserIdOrThrow(userId);
    const open = await this.prisma.workLog.findFirst({
      where: { driverId: driver.id, clockOutAt: null },
    });
    if (!open) {
      throw new ConflictException('no_open_shift');
    }
    // With an order in hand — a return being carried back included — he may
    // still end the shift, but only after saying "not today" and why. The
    // first press gets the list back so the app can ask "will you deliver it
    // today?"; "yes" keeps him on shift, "no" comes back with carry_over.
    // A booking for tomorrow is not in hand: it opens at 00:01 on its day.
    const now = new Date();
    const inHand = (
      await this.prisma.order.findMany({
        where: { assignedDriverId: driver.id, status: { in: [...IN_PROGRESS_ORDER_STATUSES] } },
        select: { id: true, orderNumber: true, status: true, clientName: true, bookingKind: true, deliveryDatetime: true, startAfterNine: true, createdBySellerId: true },
        orderBy: { orderNumber: 'asc' },
      })
    ).filter((o) => isActionable(o, now));
    // "Polniy" (owner, 12.11.2026): the day off is taken with nothing in hand,
    // as a break is.
    const dayOff = input.day_off === true;
    if (dayOff && inHand.length > 0) throw new ConflictException('driver_busy_finish_delivery');
    if (inHand.length > 0 && !input.carry_over) {
      throw new ConflictException({
        message: 'driver_has_orders',
        orders: inHand.map((o) => ({ id: o.id, order_number: o.orderNumber, status: o.status, client_name: o.clientName })),
      });
    }
    const carryOver = inHand.length > 0 ? input.carry_over! : null;
    const carryOverText = carryOver
      ? [CARRY_OVER_LABEL_UZ[carryOver.reason], carryOver.comment?.trim()].filter(Boolean).join('. ')
      : null;

    // Same rule as clock-in: the server decides whether this is an early finish,
    // and an unexplained one is rejected. Leaving early to deliver tomorrow has
    // already been explained — that reason stands for both. "Early" is against
    // the end of the day the shift began: past midnight is never early.
    const beforeEnd = earlyMinutesAt(open.clockInAt, open.expectedEnd, now);
    const isEarly = beforeEnd > 0;
    const earlyReason = dayOff
      ? ['Javob olgan (polniy)', input.early_leave_reason?.trim()].filter(Boolean).join(': ')
      : input.early_leave_reason?.trim() || carryOverText;
    if (isEarly && !earlyReason) {
      throw new BadRequestException('early_leave_reason_required');
    }

    const log = await this.prisma.$transaction(async (tx) => {
      // Only while still open: a second tap, or the auto-close getting there
      // first, used to add the break twice and repeat the carry-overs
      // (audit, 07.11.2026).
      const { count } = await tx.workLog.updateMany({
        where: { id: open.id, clockOutAt: null },
        data: {
          clockOutAt: now,
          earlyLeaveReason: isEarly || dayOff ? earlyReason : null,
          isEarlyLeave: isEarly,
          dayOff,
          earlyMinutes: isEarly ? beforeEnd : 0,
          breakMinutes: { increment: breakTakenMinutes(driver, now) },
          closeSource: source,
          // STOP on the end-of-day reminder is his answer to it.
          ...(source === 'end_check_stop' ? { endCheckAnsweredAt: now } : {}),
        },
      });
      await tx.driverBreak.updateMany({ where: { driverId: driver.id, endedAt: null }, data: { endedAt: now } });
      if (count === 0) throw new ConflictException('no_open_shift');
      await tx.driver.update({
        where: { id: driver.id },
        data: { currentStatus: 'offline', breakUntil: null, breakStartedAt: null, breakReason: null },
      });
      if (carryOver) {
        await tx.orderCarryOver.createMany({
          data: inHand.map((o) => ({
            orderId: o.id,
            driverId: driver.id,
            workLogId: open.id,
            reason: carryOver.reason,
            comment: carryOver.comment?.trim() || null,
          })),
        });
      }
      return tx.workLog.findUniqueOrThrow({ where: { id: open.id }, include: WORK_LOG_INCLUDE });
    });
    this.realtime.driverStatusChanged(driver.id, 'offline');
    if (carryOver) await this.announceCarryOver(driver.id, inHand, carryOverText!);
    return this.workLogToPublic(log);
  }

  /**
   * Tell the seller of each carried-over order, and staff, that it will not
   * arrive today and why — so the customer can be told before he waits all
   * evening. A failure here never undoes the clock-out.
   */
  private async announceCarryOver(
    driverId: string,
    orders: { id: string; orderNumber: number; clientName: string; createdBySellerId: string }[],
    why: string,
  ): Promise<void> {
    try {
      const [driver, staff] = await Promise.all([
        this.prisma.driver.findUnique({ where: { id: driverId }, select: { user: { select: { name: true } } } }),
        this.prisma.user.findMany({ where: { role: { in: ['admin', 'manager'] }, status: 'active' }, select: { id: true } }),
      ]);
      const name = driver?.user.name ?? 'Haydovchi';
      for (const o of orders) {
        const recipients = [...new Set([o.createdBySellerId, ...staff.map((u) => u.id)])];
        await this.notifications.notifyMany(recipients, {
          type: 'order.carried_over',
          title: 'Buyurtma bugun yetkazilmaydi',
          body: `${o.clientName} buyurtmasi bugun yetkazilmaydi — ${name}: ${why}. Ertaga yetkaziladi.`,
          relatedOrderId: o.id,
          clientName: o.clientName,
        });
      }
    } catch (err) {
      this.logger.error(`carry-over notice failed: ${(err as Error).message}`);
    }
  }

  /**
   * "+30 min" on the end-of-day reminder: he is still working. The count of
   * unanswered reminders starts over and he is asked again in 30 minutes.
   * He says what work he is still on; each note is kept with its time for
   * the office, and each press confirms 30 more minutes (owner, 07.11.2026).
   */
  async extendShift(userId: string, input: ExtendShiftInput = {}): Promise<DriverMe> {
    const note = input.note?.trim() ?? '';
    // Temporarily accepted without a note (09.11.2026): the app with the note
    // field is held back while a start-up fault is found; the older app sends none.
    const driver = await this.getDriverByUserIdOrThrow(userId);
    const now = new Date();
    const open = await this.prisma.workLog.findFirst({
      where: { driverId: driver.id, clockOutAt: null },
      select: { id: true, endCheckNotes: true },
    });
    if (!open) throw new ConflictException('no_open_shift');
    const notes = [
      ...readEndCheckNotes(open.endCheckNotes).map((n) => ({ at: n.at.toISOString(), note: n.note })),
      ...(note ? [{ at: now.toISOString(), note: note.slice(0, END_CHECK_NOTE_MAX) }] : []),
    ];
    const { count } = await this.prisma.workLog.updateMany({
      where: { id: open.id, clockOutAt: null },
      data: { endCheckAnsweredAt: now, endCheckUnanswered: 0, endCheckRanAt: now, endCheckNotes: notes },
    });
    if (count === 0) throw new ConflictException('no_open_shift');
    return this.findByUserId(userId);
  }

  /**
   * "STOP" on the end-of-day reminder: end the shift now. Same rules as the
   * toggle — an order still in hand refuses it — and recorded as his answer.
   */
  async stopShift(userId: string, input: ClockOutInput = {}): Promise<WorkLogPublic> {
    return this.clockOut(userId, input, 'end_check_stop');
  }

  /**
   * Start a short break (Tanaffus) for N hours — the seller board shows the
   * vehicle as excused (black) until it elapses. Only on shift, and not in
   * the middle of a delivery: the board would show him resting while he
   * drives. The time comes off the shift's worked minutes.
   */
  /**
   * He is stepping away: from when, until when, and why.
   *
   * The hours form is still accepted because a phone that has not taken the
   * update yet still sends it; anything that arrives with a start and an end
   * uses those, which is what the driver actually chose on the clock.
   */
  async startBreak(userId: string, input: DriverBreakInput) {
    const driver = await this.getDriverByUserIdOrThrow(userId);
    const open = await this.prisma.workLog.findFirst({
      where: { driverId: driver.id, clockOutAt: null },
    });
    if (!open) throw new ConflictException('no_open_shift');
    const now = new Date();
    const startsAt = input.from ? new Date(input.from) : now;
    const endsAt = input.to
      ? new Date(input.to)
      : new Date(startsAt.getTime() + (input.hours ?? 1) * 3_600_000);
    if (endsAt <= startsAt) throw new BadRequestException('break_end_before_start');
    // A break is today's business: a driver who meant 09:00 tomorrow has
    // mis-set the clock, and an eight-hour "break" is a day off, not a break.
    if (endsAt.getTime() - startsAt.getTime() > 8 * 3_600_000) {
      throw new BadRequestException('break_too_long');
    }
    if (
      (await ordersInHand(this.prisma, driver.id, IN_PROGRESS_ORDER_STATUSES, { now })).length > 0
    ) {
      throw new ConflictException('driver_busy_finish_delivery');
    }
    await this.prisma.$transaction([
      // A new break closes the books on the one before it.
      this.prisma.workLog.update({
        where: { id: open.id },
        data: { breakMinutes: { increment: breakTakenMinutes(driver, now) } },
      }),
      this.prisma.driverBreak.updateMany({ where: { driverId: driver.id, endedAt: null }, data: { endedAt: now } }),
      // Kept for the office (owner, 12.11.2026).
      this.prisma.driverBreak.create({
        data: {
          driverId: driver.id,
          workLogId: open.id,
          startedAt: startsAt,
          plannedUntil: endsAt,
          until: endsAt,
          reason: input.reason?.trim() || null,
        },
      }),
      this.prisma.driver.update({
        where: { id: driver.id },
        data: {
          breakStartedAt: startsAt,
          breakUntil: endsAt,
          breakReason: input.reason?.trim() || null,
        },
      }),
    ]);
    this.realtime.driverStatusChanged(driver.id);
    return this.findByUserId(userId);
  }

  /** End the current break early. */
  async endBreak(userId: string) {
    const driver = await this.getDriverByUserIdOrThrow(userId);
    const taken = breakTakenMinutes(driver, new Date());
    await this.prisma.$transaction([
      ...(taken > 0
        ? [
            this.prisma.workLog.updateMany({
              where: { driverId: driver.id, clockOutAt: null },
              data: { breakMinutes: { increment: taken } },
            }),
          ]
        : []),
      this.prisma.driver.update({
        where: { id: driver.id },
        data: { breakUntil: null, breakStartedAt: null, breakReason: null },
      }),
      this.prisma.driverBreak.updateMany({ where: { driverId: driver.id, endedAt: null }, data: { endedAt: new Date() } }),
    ]);
    this.realtime.driverStatusChanged(driver.id);
    return this.findByUserId(userId);
  }

  /**
   * A longer break (owner, 12.11.2026): while it runs or once its end has
   * passed but he is not back yet — the red screens out, five minutes after,
   * and he cannot start yet. Always with a reason; no limit on how often.
   * The office sees each extension under the shift.
   */
  async extendBreak(userId: string, input: DriverBreakExtendInput) {
    const driver = await this.getDriverByUserIdOrThrow(userId);
    if (!driver.breakUntil) throw new ConflictException('no_break_to_extend');
    const open = await this.prisma.workLog.findFirst({ where: { driverId: driver.id, clockOutAt: null } });
    if (!open) throw new ConflictException('no_open_shift');
    const now = new Date();
    const to = new Date(input.to);
    if (to.getTime() <= Math.max(now.getTime(), driver.breakUntil.getTime())) throw new BadRequestException('break_extend_not_later');
    const row =
      (await this.prisma.driverBreak.findFirst({ where: { driverId: driver.id, endedAt: null }, orderBy: { startedAt: 'desc' } })) ??
      // A break begun before breaks were kept: its row is made now.
      (await this.prisma.driverBreak.create({
        data: {
          driverId: driver.id,
          workLogId: open.id,
          startedAt: driver.breakStartedAt ?? now,
          plannedUntil: driver.breakUntil,
          until: driver.breakUntil,
          reason: driver.breakReason,
        },
      }));
    const extensions = Array.isArray(row.extensions) ? (row.extensions as Prisma.JsonArray) : [];
    await this.prisma.$transaction([
      this.prisma.driver.update({ where: { id: driver.id }, data: { breakUntil: to } }),
      this.prisma.driverBreak.update({
        where: { id: row.id },
        data: {
          until: to,
          remindedFor: null,
          extensions: [...extensions, { at: now.toISOString(), from: driver.breakUntil.toISOString(), to: to.toISOString(), reason: input.reason.trim() }],
        },
      }),
    ]);
    this.realtime.driverStatusChanged(driver.id);
    return this.findByUserId(userId);
  }

  /**
   * Staff correcting a shift — a forgotten clock-out, or one the system closed
   * at the wrong time. Sending clock_out_at for an open shift closes it (and
   * takes the driver off shift). Lateness and early leave are worked out again
   * against the shift's own snapshot; the reasons he gave are kept.
   */
  async correctWorkLog(
    driverId: string,
    logId: string,
    input: CorrectWorkLogInput,
    actor: { userId: string },
  ): Promise<WorkLogPublic> {
    const log = await this.prisma.workLog.findFirst({ where: { id: logId, driverId } });
    if (!log) throw new NotFoundException('Work log not found');
    const now = new Date();
    const clockInAt = input.clock_in_at ? new Date(input.clock_in_at) : log.clockInAt;
    const clockOutAt = input.clock_out_at ? new Date(input.clock_out_at) : log.clockOutAt;
    // A shift in a paid, locked period, or moved into one, stays as paid (owner, 07.11.2026).
    // Only closing a shift still open is allowed there: its start unchanged, just the end
    // set — a Viloyat shift of the 15th still open after the lock (owner, 07.11.2026).
    const onlyClosing =
      !log.clockOutAt && !!input.clock_out_at && clockInAt.getTime() === log.clockInAt.getTime();
    if (!onlyClosing && (isPayDayLocked(log.clockInAt, now) || isPayDayLocked(clockInAt, now))) {
      throw new BadRequestException('period_locked');
    }
    if (
      clockInAt.getTime() > now.getTime() ||
      (clockOutAt && clockOutAt.getTime() > now.getTime())
    ) {
      throw new BadRequestException('shift_time_in_future');
    }
    if (clockOutAt && clockOutAt.getTime() <= clockInAt.getTime()) {
      throw new BadRequestException('shift_end_before_start');
    }
    // It may not run into another of his shifts.
    const overlap = await this.prisma.workLog.findFirst({
      where: {
        driverId,
        id: { not: log.id },
        clockInAt: { lt: clockOutAt ?? new Date(8.64e15) },
        OR: [{ clockOutAt: null }, { clockOutAt: { gt: clockInAt } }],
      },
      select: { id: true },
    });
    if (overlap) throw new ConflictException('shift_overlaps_another');

    // Only the day's first shift can be late — same rule as clock-in.
    const earlier = await this.prisma.workLog.count({
      where: {
        driverId,
        id: { not: log.id },
        clockInAt: { gte: tashkentDayStartUtc(tashkentDateKey(clockInAt)), lt: clockInAt },
      },
    });
    const grace = await this.schedule.graceMinutes();
    const pastStart = lateMinutesAt(clockInAt, log.expectedStart);
    const isLate = earlier === 0 && pastStart > grace;
    const early = clockOutAt ? earlyMinutesAt(clockInAt, log.expectedEnd, clockOutAt) : 0;
    const closing = !log.clockOutAt && !!clockOutAt;
    // Closing a shift takes the driver off duty — but only if it is the shift
    // he is on. An admin tidying up a forgotten shift from last week used to
    // knock a driver who was out working today straight offline.
    const otherOpen = closing
      ? await this.prisma.workLog.count({
          where: { driverId, id: { not: log.id }, clockOutAt: null },
        })
      : 0;
    const goingOffDuty = closing && otherOpen === 0;
    // New times on a closed shift: its evening extra is worked out again, as
    // reconsiderClosedShifts does (audit, 07.11.2026).
    const recheckEvening =
      !!log.clockOutAt &&
      (clockInAt.getTime() !== log.clockInAt.getTime() || clockOutAt?.getTime() !== log.clockOutAt.getTime());
    const actorName =
      (await this.prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true } }))
        ?.name ?? null;
    // Closing it ends a break still running, up to the new clock-out.
    const breakTaken = closing
      ? breakTakenMinutes(
          await this.prisma.driver.findUniqueOrThrow({ where: { id: driverId } }),
          clockOutAt!,
        )
      : 0;

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.workLog.update({
        where: { id: log.id },
        data: {
          clockInAt,
          clockOutAt,
          isLate,
          lateMinutes: isLate ? pastStart : 0,
          isEarlyLeave: early > 0,
          earlyMinutes: early,
          ...(closing ? { closeSource: 'admin', breakMinutes: { increment: breakTaken } } : {}),
          ...(recheckEvening ? { eveningCheckedAt: null } : {}),
          correctedAt: now,
          correctedById: actor.userId,
          correctedByName: actorName,
          correctionNote: input.note.trim(),
        },
        include: WORK_LOG_INCLUDE,
      });
      if (closing) await tx.driverBreak.updateMany({ where: { driverId: log.driverId, endedAt: null }, data: { endedAt: now } });
      if (recheckEvening) await tx.eveningOvertime.deleteMany({ where: { workLogId: log.id } });
      if (goingOffDuty) {
        await tx.driver.update({
          where: { id: driverId },
          data: { currentStatus: 'offline', breakUntil: null, breakStartedAt: null, breakReason: null },
        });
      }
      return row;
    });
    if (goingOffDuty) this.realtime.driverStatusChanged(driverId, 'offline');
    return this.workLogToPublic(updated);
  }

  /** A driver's own shift history, most recent first. */
  async listMyWorkLogs(userId: string): Promise<WorkLogPublic[]> {
    const driver = await this.getDriverByUserIdOrThrow(userId);
    return this.listWorkLogsFor(driver.id);
  }

  /** Admin: a driver's shift history, most recent first. */
  async listWorkLogs(driverId: string): Promise<WorkLogPublic[]> {
    await this.getOrThrow(driverId);
    return this.listWorkLogsFor(driverId);
  }

  /**
   * Aggregated timesheet: completed shifts grouped per driver over an inclusive
   * date range, with distinct days worked, total minutes, and shift count.
   */
  async getTimesheet(filters: TimesheetFilterInput): Promise<TimesheetRow[]> {
    return this.buildDriverRows(await this.fetchCompletedShifts(filters), filters);
  }

  /**
   * Work-time report: the per-driver rows plus a team-wide daily breakdown and an
   * overall summary (totals + average per driver) over the same period.
   */
  async getWorkReport(filters: TimesheetFilterInput): Promise<WorkReport> {
    const logs = await this.fetchCompletedShifts(filters);
    const byDriver = this.buildDriverRows(logs, filters);

    const byDay = new Map<string, { minutes: number; shifts: number }>();
    for (const l of logs) {
      for (const d of workedByDay(l)) {
        if (d.date < filters.from || d.date > filters.to) continue;
        const entry = byDay.get(d.date) ?? { minutes: 0, shifts: 0 };
        entry.minutes += d.minutes;
        byDay.set(d.date, entry);
      }
      const started = tashkentDateKey(l.clockInAt);
      if (started >= filters.from && started <= filters.to) {
        const entry = byDay.get(started) ?? { minutes: 0, shifts: 0 };
        entry.shifts += 1;
        byDay.set(started, entry);
      }
    }
    const totalMinutes = byDriver.reduce((s, r) => s + r.total_minutes, 0);
    const totalShifts = byDriver.reduce((s, r) => s + r.shift_count, 0);

    const by_day = [...byDay.entries()]
      .map(([date, d]) => ({ date, total_minutes: d.minutes, shift_count: d.shifts }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    return {
      summary: {
        total_minutes: totalMinutes,
        total_shifts: totalShifts,
        driver_count: byDriver.length,
        avg_minutes_per_driver: byDriver.length ? Math.round(totalMinutes / byDriver.length) : 0,
      },
      by_day,
      by_driver: byDriver,
    };
  }

  /**
   * Completed shifts that overlap the inclusive [from, to] range of Tashkent
   * days — a shift begun the evening before still counts its hours after
   * midnight. (Days used to be UTC, starting at 05:00 Tashkent.)
   */
  private fetchCompletedShifts(filters: TimesheetFilterInput) {
    const start = tashkentDayStartUtc(filters.from);
    const end = new Date(tashkentDayStartUtc(filters.to).getTime() + 86_400_000);
    return this.prisma.workLog.findMany({
      where: { clockInAt: { lt: end }, clockOutAt: { not: null, gt: start } },
      include: { driver: { include: { user: true } } },
      orderBy: { clockInAt: 'asc' },
    });
  }

  /**
   * Per driver: minutes worked on each day of the range (breaks excluded, a
   * shift over midnight split across its days), the days with any work, and
   * the shifts that began in the range.
   */
  private buildDriverRows(
    logs: {
      driverId: string;
      clockInAt: Date;
      clockOutAt: Date | null;
      breakMinutes: number;
      driver: { user: { name: string } };
    }[],
    range: { from: string; to: string },
  ): TimesheetRow[] {
    const byDriver = new Map<
      string,
      { name: string; minutes: number; days: Set<string>; shifts: number }
    >();
    for (const l of logs) {
      const entry = byDriver.get(l.driverId) ?? {
        name: l.driver.user.name,
        minutes: 0,
        days: new Set<string>(),
        shifts: 0,
      };
      for (const d of workedByDay(l)) {
        if (d.date < range.from || d.date > range.to) continue;
        entry.minutes += d.minutes;
        entry.days.add(d.date);
      }
      const started = tashkentDateKey(l.clockInAt);
      if (started >= range.from && started <= range.to) entry.shifts += 1;
      byDriver.set(l.driverId, entry);
    }

    return [...byDriver.entries()]
      .map(([driver_id, e]) => ({
        driver_id,
        name: e.name,
        days_worked: e.days.size,
        total_minutes: e.minutes,
        shift_count: e.shifts,
      }))
      .sort((a, b) => b.total_minutes - a.total_minutes);
  }

  /**
   * Admin's view of the end-of-day check: open shifts found outside Tashkent,
   * shifts the system closed in the last day, and carried-over orders from
   * the last day that are still undelivered.
   */
  async getShiftAlerts(now: Date = new Date()): Promise<ShiftAlerts> {
    const since = new Date(now.getTime() - ALERT_WINDOW_MS);
    const driverName = { driver: { select: { user: { select: { name: true } } } } } as const;
    const todayStart = tashkentDayStartUtc(tashkentDateKey(now));
    const [viloyat, autoClosed, carried] = await Promise.all([
      this.prisma.workLog.findMany({
        where: { clockOutAt: null, endCheckZone: 'viloyat' },
        orderBy: { clockInAt: 'asc' },
        include: driverName,
      }),
      this.prisma.workLog.findMany({
        where: { autoClosed: true, correctedAt: null, clockOutAt: { gte: since } },
        orderBy: { clockOutAt: 'desc' },
        include: driverName,
      }),
      this.prisma.orderCarryOver.findMany({
        where: { createdAt: { gte: since }, order: { status: { in: [...ACTIVE_ORDER_STATUSES] } } },
        orderBy: { createdAt: 'desc' },
        include: { ...driverName, order: { select: { orderNumber: true, clientName: true } } },
      }),
    ]);
    // Today's shifts with no position for a while: GPS or internet off.
    const todays = await this.prisma.workLog.findMany({
      where: { clockInAt: { gte: todayStart } },
      select: { id: true, driverId: true, clockInAt: true, clockOutAt: true, ...driverName },
    });
    const fixes = todays.length
      ? await this.prisma.driverLocationPing.findMany({
          where: { driverId: { in: [...new Set(todays.map((l) => l.driverId))] }, recordedAt: { gte: todayStart } },
          select: { driverId: true, recordedAt: true },
        })
      : [];
    const silent = todays
      .map((l) => {
        const gaps = silentGaps(
          fixes.filter((f) => f.driverId === l.driverId).map((f) => f.recordedAt),
          l.clockInAt,
          l.clockOutAt ?? now,
        );
        if (gaps.length === 0) return null;
        const longest = gaps.reduce((a, b) => (b.minutes > a.minutes ? b : a));
        return {
          driver_id: l.driverId,
          name: l.driver.user.name,
          work_log_id: l.id,
          minutes: gaps.reduce((s, g) => s + g.minutes, 0),
          longest_from: longest.from.toISOString(),
          longest_to: longest.to.toISOString(),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.minutes - a.minutes);
    return {
      silent,
      viloyat: viloyat.map((l) => ({
        driver_id: l.driverId,
        name: l.driver.user.name,
        work_log_id: l.id,
        clock_in_at: l.clockInAt.toISOString(),
        checked_at: l.endCheckRanAt?.toISOString() ?? null,
      })),
      auto_closed: autoClosed.map((l) => ({
        driver_id: l.driverId,
        name: l.driver.user.name,
        work_log_id: l.id,
        clock_in_at: l.clockInAt.toISOString(),
        clock_out_at: l.clockOutAt!.toISOString(),
        close_source: l.closeSource,
      })),
      carried_over: carried.map((c) => ({
        driver_id: c.driverId,
        name: c.driver.user.name,
        order_id: c.orderId,
        order_number: c.order.orderNumber,
        client_name: c.order.clientName,
        reason: c.reason as CarryOverReason,
        comment: c.comment,
        at: c.createdAt.toISOString(),
      })),
    };
  }

  private async listWorkLogsFor(driverId: string): Promise<WorkLogPublic[]> {
    const logs = await this.prisma.workLog.findMany({
      where: { driverId },
      orderBy: { clockInAt: 'desc' },
      take: 100,
      include: WORK_LOG_INCLUDE,
    });
    return logs.map((l) => this.workLogToPublic(l));
  }

  private async getDriverByUserIdOrThrow(userId: string): Promise<Driver> {
    const driver = await this.prisma.driver.findUnique({ where: { userId } });
    if (!driver) {
      throw new ForbiddenException('Only a driver can perform this action');
    }
    return driver;
  }

  private workLogToPublic(l: WorkLog & { carryOvers?: WorkLogCarryOver[]; breaks?: DriverBreakRow[] }): WorkLogPublic {
    return {
      id: l.id,
      driver_id: l.driverId,
      clock_in_at: l.clockInAt.toISOString(),
      clock_out_at: l.clockOutAt?.toISOString() ?? null,
      duration_minutes: l.clockOutAt ? netMinutes(l) : null,
      late_reason: l.lateReason,
      early_leave_reason: l.earlyLeaveReason,
      is_late: l.isLate,
      late_minutes: l.lateMinutes,
      is_early_leave: l.isEarlyLeave,
      early_minutes: l.earlyMinutes,
      expected_start: l.expectedStart,
      expected_end: l.expectedEnd,
      close_source: l.closeSource,
      auto_closed: l.autoClosed,
      end_check_zone: l.endCheckZone,
      end_check_notes: readEndCheckNotes(l.endCheckNotes).map((n) => ({ at: n.at.toISOString(), note: n.note })),
      carry_overs: (l.carryOvers ?? []).map((c) => ({
        order_id: c.orderId,
        order_number: c.order.orderNumber,
        client_name: c.order.clientName,
        reason: c.reason as CarryOverReason,
        comment: c.comment,
      })),
      break_minutes: l.breakMinutes,
      day_off: l.dayOff ?? false,
      breaks: (l.breaks ?? []).map(breakToPublic),
      corrected_at: l.correctedAt?.toISOString() ?? null,
      corrected_by_name: l.correctedByName,
      correction_note: l.correctionNote,
    };
  }

  // --- Driver documents (license, insurance, …) ---

  async listDocuments(driverId: string): Promise<DriverDocumentPublic[]> {
    await this.getOrThrow(driverId);
    const docs = await this.prisma.driverDocument.findMany({
      where: { driverId },
      orderBy: { expiresAt: 'asc' },
    });
    return docs.map((d) => this.docToPublic(d));
  }

  async addDocument(
    driverId: string,
    input: CreateDriverDocumentInput,
  ): Promise<DriverDocumentPublic> {
    await this.getOrThrow(driverId);
    const doc = await this.prisma.driverDocument.create({
      data: {
        driverId,
        type: input.type,
        number: input.number ?? null,
        issuedAt: input.issued_at ? toDate(input.issued_at) : null,
        expiresAt: toDate(input.expires_at),
        notes: input.notes ?? null,
      },
    });
    return this.docToPublic(doc);
  }

  async updateDocument(
    driverId: string,
    docId: string,
    input: UpdateDriverDocumentInput,
  ): Promise<DriverDocumentPublic> {
    await this.getDocOrThrow(driverId, docId);
    const doc = await this.prisma.driverDocument.update({
      where: { id: docId },
      data: {
        ...(input.type !== undefined && { type: input.type }),
        ...(input.number !== undefined && { number: input.number }),
        ...(input.issued_at !== undefined && {
          issuedAt: input.issued_at ? toDate(input.issued_at) : null,
        }),
        // Editing the expiry date re-arms the reminder so staff are notified afresh.
        ...(input.expires_at !== undefined && {
          expiresAt: toDate(input.expires_at),
          expiryNotifiedStage: null,
        }),
        ...(input.notes !== undefined && { notes: input.notes }),
      },
    });
    return this.docToPublic(doc);
  }

  async removeDocument(driverId: string, docId: string): Promise<{ deleted: true }> {
    await this.getDocOrThrow(driverId, docId);
    await this.prisma.driverDocument.delete({ where: { id: docId } });
    return { deleted: true };
  }

  private async getDocOrThrow(driverId: string, docId: string): Promise<DriverDocument> {
    const doc = await this.prisma.driverDocument.findUnique({ where: { id: docId } });
    if (!doc || doc.driverId !== driverId) {
      throw new NotFoundException('Driver document not found');
    }
    return doc;
  }

  private docToPublic(d: DriverDocument): DriverDocumentPublic {
    return {
      id: d.id,
      driver_id: d.driverId,
      type: d.type as DriverDocType,
      number: d.number,
      issued_at: d.issuedAt?.toISOString() ?? null,
      expires_at: d.expiresAt.toISOString(),
      notes: d.notes,
      created_at: d.createdAt.toISOString(),
      updated_at: d.updatedAt.toISOString(),
    };
  }

  /** A vehicle must exist and not already be assigned to a different driver. */
  private async assertVehicleAssignable(
    vehicleId: string,
    excludeDriverId?: string,
  ): Promise<void> {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) {
      throw new NotFoundException('Vehicle not found');
    }
    const takenBy = await this.prisma.driver.findFirst({
      where: { vehicleId, ...(excludeDriverId ? { id: { not: excludeDriverId } } : {}) },
    });
    if (takenBy) {
      throw new ConflictException('vehicle_already_assigned');
    }
  }

  private async getOrThrow(id: string): Promise<DriverWithUser> {
    const driver = await this.prisma.driver.findUnique({
      where: { id },
      include: DRIVER_INCLUDE,
    });
    if (!driver) {
      throw new NotFoundException('Driver not found');
    }
    return driver;
  }

  private toPublic(d: DriverWithUser): DriverPublic {
    return {
      id: d.id,
      user_id: d.userId,
      name: d.user.name,
      phone_number: d.user.phoneNumber,
      telegram_id: d.user.telegramId ?? null,
      current_status: d.currentStatus as DriverStatus,
      vehicle_info: d.vehicleInfo,
      vehicle_id: d.vehicleId,
      vehicle_plate: d.vehicle?.plateNumber ?? null,
      vehicle_model: d.vehicle?.model ?? null,
      vehicle_current_km: d.vehicle?.currentKm ?? null,
      vehicle_category: (d.vehicle?.category as DriverPublic['vehicle_category']) ?? null,
      license_front_url: d.licenseFrontUrl,
      license_back_url: d.licenseBackUrl,
      vehicle_tech_passport: d.vehicle?.techPassport ?? null,
      vehicle_tech_passport_front_url: d.vehicle?.techPassportFrontUrl ?? null,
      vehicle_tech_passport_back_url: d.vehicle?.techPassportBackUrl ?? null,
      vehicle_capacity_kg: d.vehicle?.capacityKg ?? null,
      vehicle_length_cm: d.vehicle?.lengthCm ?? null,
      vehicle_width_cm: d.vehicle?.widthCm ?? null,
      vehicle_height_cm: d.vehicle?.heightCm ?? null,
      vehicle_model_year: d.vehicle?.modelYear ?? null,
      vehicle_documents: latestPerType(d.vehicle?.documents ?? []),
      birth_date: d.birthDate ? d.birthDate.toISOString().slice(0, 10) : null,
      license_category: d.licenseCategory,
      license_issued_at: d.licenseIssuedAt ? d.licenseIssuedAt.toISOString().slice(0, 10) : null,
      license_expires_at: d.licenseExpiresAt ? d.licenseExpiresAt.toISOString().slice(0, 10) : null,
      license_years: licenseYears(d.licenseIssuedAt),
      home_district_code: d.homeDistrictCode,
      home_district_name: d.homeDistrict?.name ?? null,
      docs_expiry_alert: docsExpiryAlert(d.documents),
      shift_started_at: d.workLogs?.[0]?.clockInAt.toISOString() ?? null,
      break_until: d.breakUntil?.toISOString() ?? null,
      break_started_at: d.breakStartedAt?.toISOString() ?? null,
      break_reason: d.breakReason ?? null,
      lat: d.locationLat,
      lng: d.locationLng,
      location_updated_at: d.locationUpdatedAt?.toISOString() ?? null,
      created_at: d.createdAt.toISOString(),
      updated_at: d.updatedAt.toISOString(),
    };
  }
}

/**
 * How far the phone's clock is behind the server's (owner, 06.11.2026): a
 * driver who sets his phone's clock back or forward would move his morning
 * start and evening times with it. The phone says what its clock read when it
 * sent; the gap is added to every point. Under two minutes is network delay
 * and an ordinary clock, and is left alone.
 */
export function clockSkewMs(sentAt: string | undefined, now: Date): number {
  if (!sentAt) return 0;
  const skew = now.getTime() - new Date(sentAt).getTime();
  return Number.isFinite(skew) && Math.abs(skew) >= 120_000 ? skew : 0;
}

/** One break as the admin reads it (owner, 12.11.2026). */
function breakToPublic(b: DriverBreakRow): DriverBreakPublic {
  const ext = Array.isArray(b.extensions) ? (b.extensions as { at: string; from: string; to: string; reason: string }[]) : [];
  return {
    started_at: b.startedAt.toISOString(),
    planned_until: b.plannedUntil.toISOString(),
    until: b.until.toISOString(),
    reason: b.reason,
    extensions: ext.map((e) => ({ at: String(e.at), from: String(e.from), to: String(e.to), reason: String(e.reason) })),
    ended_at: b.endedAt?.toISOString() ?? null,
  };
}
