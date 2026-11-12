import { syncServiceExpense } from '../expenses/auto-expense';
import { onBreakAt } from '../drivers/gps-window';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { Prisma, ServiceCenter as CenterRow, ServiceReason as ReasonRow } from '@prisma/client';
import {
  type AddServiceVisitItemInput,
  type AssignServiceVisitInput,
  type CompleteServiceVisitInput,
  type CorrectServiceTotalInput,
  type CreateServiceCenterInput,
  type CreateServiceReasonInput,
  type CreateServiceVisitInput,
  type DeclineServiceVisitInput,
  type FuelLogFlag,
  type FuelLogOutcome,
  type FuelSettlement,
  type FuelSettlementState,
  type NearbyServiceCenter,
  type ServiceCenter,
  type ServiceCenterTotal,
  type ServiceDriverDebt,
  type ServiceDueItem,
  type ServiceReason,
  type ServiceSummary,
  type ServiceVisit,
  type ServiceVisitStatus,
  type SetServiceBaselineInput,
  type SettleServiceVisitInput,
  type StartServiceVisitInput,
  type SuggestServiceReasonInput,
  type UpdateServiceCenterInput,
  type UpdateServiceReasonInput,
  SERVICE_DUE_SOON_KM,
} from '@bigant/shared';
import { PrismaService } from '../prisma/prisma.service';
import { UploadService } from '../upload/upload.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TelegramService } from '../telegram/telegram.service';
import { ReceiptReaderService, readTotal } from './receipt-reader.service';
import type { AuthenticatedUser as Actor } from '../common/decorators/current-user.decorator';
import { classifyFill, nearestPlaces, type TimedFix } from '../fuel/fuel.geometry';
import { dueState, reminderDue } from './service-due';
import { KM_JUMP_MAX, notifyKmJump } from '../vehicles/vehicles.service';

const OPEN: ServiceVisitStatus[] = ['requested', 'approved', 'in_progress'];

const VISIT_INCLUDE = {
  items: { orderBy: { position: 'asc' as const } },
  vehicle: { select: { plateNumber: true, model: true } },
  driver: { select: { id: true, user: { select: { name: true } } } },
  selectedCenter: true,
  resolvedCenter: true,
  decidedBy: { select: { name: true } },
  assignedBy: { select: { name: true } },
  reviewedBy: { select: { name: true } },
  order: { select: { orderNumber: true, clientName: true } },
} as const;
type VisitRow = Prisma.ServiceVisitGetPayload<{ include: typeof VISIT_INCLUDE }>;

const SETTLEMENT_STATE_WHERE: Record<FuelSettlementState, Prisma.ServiceVisitWhereInput> = {
  pending: { settlement: null },
  unpaid: { settlement: { not: null }, settledAt: null },
  paid: { settledAt: { not: null } },
};
const DEFAULT_SETTLEMENT: Record<FuelLogOutcome, FuelSettlement | null> = {
  matched: 'station_invoice',
  other_station: 'station_invoice',
  unlisted: 'driver_reimbursement',
  mismatch: null,
  unverified: null,
};
type Period = { from?: Date; to?: Date };

/** A visit the driver may still change the works on. */
const OPEN_STATUSES: readonly ServiceVisitStatus[] = ['requested', 'approved', 'in_progress'];

@Injectable()
export class ServiceService {
  private readonly logger = new Logger(ServiceService.name);

  /** The visit's cost in Xarajatlar; the visit is saved whatever happens here. */
  private syncExpense(visitId: string): void {
    void syncServiceExpense(this.prisma, visitId).catch((err: Error) =>
      this.logger.warn(`service expense sync failed: ${err?.message}`),
    );
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly upload: UploadService,
    private readonly notifications: NotificationsService,
    private readonly telegram: TelegramService,
    @Optional() private readonly receiptReader?: ReceiptReaderService,
  ) {}

  // ------------------------------------------------------------------ reasons

  /** What a driver can tick: the catalogue, plus anything they added themselves. */
  async reasonsForDriver(actor: Actor): Promise<ServiceReason[]> {
    const driver = await this.driverOf(actor);
    const rows = await this.prisma.serviceReason.findMany({
      where: { active: true, OR: [{ approved: true }, { createdByDriverId: driver.id }] },
      include: { createdByDriver: { select: { user: { select: { name: true } } } } },
      orderBy: [{ approved: 'desc' }, { name: 'asc' }],
    });
    return rows.map(toReason);
  }

  async listReasons(): Promise<ServiceReason[]> {
    const rows = await this.prisma.serviceReason.findMany({
      include: { createdByDriver: { select: { user: { select: { name: true } } } } },
      orderBy: [{ approved: 'desc' }, { active: 'desc' }, { name: 'asc' }],
    });
    return rows.map(toReason);
  }

  /**
   * A driver types a work that is not on the list. It is theirs to use at
   * once and sits in admin's "drivers added" pile until promoted — ten
   * drivers would otherwise coin ten spellings of the same thing.
   */
  async suggestReason(input: SuggestServiceReasonInput, actor: Actor): Promise<ServiceReason> {
    const driver = await this.driverOf(actor);
    const row = await this.prisma.serviceReason.create({
      data: { name: input.name, approved: false, createdByDriverId: driver.id },
      include: { createdByDriver: { select: { user: { select: { name: true } } } } },
    });
    return toReason(row);
  }

  async createReason(input: CreateServiceReasonInput): Promise<ServiceReason> {
    const row = await this.prisma.serviceReason.create({
      data: { name: input.name, intervalKm: input.interval_km ?? null, active: input.active, approved: true },
      include: { createdByDriver: { select: { user: { select: { name: true } } } } },
    });
    return toReason(row);
  }

  async updateReason(id: string, input: UpdateServiceReasonInput): Promise<ServiceReason> {
    const existing = await this.prisma.serviceReason.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('service_reason_not_found');
    const row = await this.prisma.serviceReason.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.interval_km !== undefined ? { intervalKm: input.interval_km ?? null } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.approved !== undefined ? { approved: input.approved } : {}),
      },
      include: { createdByDriver: { select: { user: { select: { name: true } } } } },
    });
    return toReason(row);
  }

  // ------------------------------------------------------------------ centres

  async listCenters(all = false): Promise<ServiceCenter[]> {
    const rows = await this.prisma.serviceCenter.findMany({
      where: all ? {} : { active: true, contracted: true },
      orderBy: all ? [{ active: 'desc' }, { name: 'asc' }] : { name: 'asc' },
    });
    return rows.map(toCenter);
  }

  async nearbyCenters(at: { lat: number; lng: number }): Promise<NearbyServiceCenter[]> {
    const rows = await this.prisma.serviceCenter.findMany({ where: { active: true, contracted: true } });
    return nearestPlaces(at, rows).map(({ place, distanceM }) => ({ ...toCenter(place), distance_m: Math.round(distanceM) }));
  }

  async createCenter(input: CreateServiceCenterInput): Promise<ServiceCenter> {
    assertPinnedOrUnpinned(input);
    return toCenter(await this.prisma.serviceCenter.create({ data: centerData(input) }));
  }

  async updateCenter(id: string, input: UpdateServiceCenterInput): Promise<ServiceCenter> {
    const existing = await this.prisma.serviceCenter.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('service_center_not_found');
    assertPinnedOrUnpinned({ lat: input.lat ?? existing.lat, lng: input.lng ?? existing.lng });
    return toCenter(await this.prisma.serviceCenter.update({ where: { id }, data: centerData(input) }));
  }

  // ------------------------------------------------------------------ what is due

  /**
   * Every scheduled work on every active vehicle (or one vehicle), with
   * where it stands and what the driver has been told about it. This is the
   * admin's list and the driver's banner, from the same computation.
   */
  async due(vehicleId?: string): Promise<ServiceDueItem[]> {
    const [vehicles, reasons, states, reminders, openVisits] = await Promise.all([
      this.prisma.vehicle.findMany({
        where: { status: 'active', ...(vehicleId ? { id: vehicleId } : {}) },
        include: { driver: { select: { id: true, user: { select: { name: true } } } } },
      }),
      this.prisma.serviceReason.findMany({ where: { active: true, approved: true, intervalKm: { not: null } } }),
      this.prisma.vehicleServiceState.findMany(vehicleId ? { where: { vehicleId } } : undefined),
      this.prisma.serviceReminder.findMany({
        ...(vehicleId ? { where: { vehicleId } } : {}),
        orderBy: { sentAt: 'desc' },
      }),
      this.prisma.serviceVisit.findMany({
        where: { status: { in: OPEN }, ...(vehicleId ? { vehicleId } : {}) },
        select: { id: true, status: true, vehicleId: true, items: { select: { reasonId: true } } },
      }),
    ]);

    const stateOf = new Map(states.map((s) => [`${s.vehicleId}:${s.reasonId}`, s]));
    const items: ServiceDueItem[] = [];
    for (const v of vehicles) {
      for (const r of reasons) {
        const st = stateOf.get(`${v.id}:${r.id}`);
        const d = dueState({ currentKm: v.currentKm, lastDoneKm: st?.lastDoneKm ?? null, intervalKm: r.intervalKm });
        const cycleKm = st?.lastDoneKm ?? null;
        const sent = reminders.filter(
          (x) => x.vehicleId === v.id && x.reasonId === r.id && (x.cycleKm ?? null) === cycleKm,
        );
        const open = openVisits.find((o) => o.vehicleId === v.id && o.items.some((i) => i.reasonId === r.id));
        items.push({
          vehicle_id: v.id,
          vehicle_plate: v.plateNumber,
          vehicle_model: v.model,
          driver_id: v.driver?.id ?? null,
          driver_name: v.driver?.user?.name ?? null,
          reason_id: r.id,
          reason_name: r.name,
          interval_km: r.intervalKm!,
          current_km: v.currentKm,
          last_done_km: st?.lastDoneKm ?? null,
          due_km: d.dueKm,
          remaining_km: d.remainingKm,
          reminders_sent: sent.length,
          last_reminded_at: sent[0]?.sentAt.toISOString() ?? null,
          open_visit_id: open?.id ?? null,
          open_visit_status: open?.status ?? null,
        });
      }
    }
    // Most urgent first; the unknowable at the end.
    return items.sort((a, b) => (a.remaining_km ?? Infinity) - (b.remaining_km ?? Infinity));
  }

  /** The driver's own: only what is in range or overdue, on their vehicle. */
  async myDue(actor: Actor): Promise<ServiceDueItem[]> {
    const driver = await this.driverOf(actor);
    if (!driver.vehicleId) return [];
    return (await this.due(driver.vehicleId)).filter((i) => i.remaining_km != null && i.remaining_km <= SERVICE_DUE_SOON_KM);
  }

  async setBaseline(vehicleId: string, input: SetServiceBaselineInput): Promise<ServiceDueItem[]> {
    const [vehicle, reason] = await Promise.all([
      this.prisma.vehicle.findUnique({ where: { id: vehicleId } }),
      this.prisma.serviceReason.findUnique({ where: { id: input.reason_id } }),
    ]);
    if (!vehicle) throw new NotFoundException('vehicle_not_found');
    if (!reason) throw new NotFoundException('service_reason_not_found');
    await this.prisma.vehicleServiceState.upsert({
      where: { vehicleId_reasonId: { vehicleId, reasonId: input.reason_id } },
      create: { vehicleId, reasonId: input.reason_id, lastDoneKm: input.last_done_km, lastDoneAt: new Date() },
      update: { lastDoneKm: input.last_done_km, lastDoneAt: new Date(), lastVisitId: null },
    });
    return this.due(vehicleId);
  }

  /**
   * One pass of the reminder rule over every vehicle. Run hourly by the
   * dispatcher and after anything that changes a vehicle's km. Sends at
   * most one push per (vehicle, work) per pass; the rule decides which.
   */
  async sendDueReminders(now = new Date()): Promise<number> {
    // In the working day, not at midnight: the day's reminder goes from 09:00 (Tashkent).
    if (Number(new Date(now.getTime() + 5 * 3_600_000).toISOString().slice(11, 13)) < 9) return 0;
    const items = await this.due();
    const reminders = await this.prisma.serviceReminder.findMany({ orderBy: { sentAt: 'desc' } });
    let sent = 0;
    for (const it of items) {
      if (!it.driver_id) continue;
      const state = dueState({ currentKm: it.current_km, lastDoneKm: it.last_done_km, intervalKm: it.interval_km });
      const history = reminders
        .filter((r) => r.vehicleId === it.vehicle_id && r.reasonId === it.reason_id)
        .map((r) => ({ kind: r.kind, sentAt: r.sentAt, cycleKm: r.cycleKm }));
      const kind = reminderDue(state, history, it.open_visit_id != null, now, it.last_done_km);
      if (!kind) continue;

      const driver = await this.prisma.driver.findUnique({ where: { id: it.driver_id }, select: { userId: true } });
      if (!driver) continue;
      const remaining = state.remainingKm ?? 0;
      const late = remaining < 0;
      const body = late
        ? `${it.reason_name}: muddati ${fmtKm(-remaining)} km o'tib ketdi. Servisga boring.`
        : `${it.reason_name}: ${fmtKm(remaining)} km qoldi — servisga kirishingiz kerak.`;
      // The row goes in first: if the push throws, the reminder is still
      // recorded and is not sent again on every hourly tick.
      await this.prisma.serviceReminder.create({
        data: { vehicleId: it.vehicle_id, reasonId: it.reason_id, kind, kmAtSend: it.current_km, cycleKm: it.last_done_km },
      });
      await this.notifications.notify(driver.userId, {
        type: late ? 'service_overdue' : 'service_due_soon',
        title: late ? "Servis muddati o'tdi" : 'Servis muddati yaqin',
        body,
      });
      // The dispatcher hears it too, every day (owner, 06.11.2026).
      const who = `${it.vehicle_plate}${it.driver_name ? ` (${it.driver_name})` : ''}`;
      await this.notifyStaff(
        late ? 'service_overdue' : 'service_due_soon',
        late ? "Servis muddati o'tdi" : 'Servis muddati yaqin',
        late
          ? `${who}: ${it.reason_name} — ${fmtKm(it.due_km ?? 0)} km da kirishi kerak edi, ${fmtKm(-remaining)} km o'tib ketdi.`
          : `${who}: ${it.reason_name} — ${fmtKm(remaining)} km qoldi (${fmtKm(it.due_km ?? 0)} km da).`,
      );
      sent += 1;
    }
    if (sent) this.logger.log(`sent ${sent} service reminder(s)`);
    return sent;
  }

  // ------------------------------------------------------------------ visits

  /**
   * The driver opens a visit. An emergency is already happening — it starts
   * in progress. A request waits for admin with its date and time.
   */
  async createVisit(input: CreateServiceVisitInput, actor: Actor): Promise<ServiceVisit> {
    const driver = await this.driverOf(actor);
    // Not on a break (owner, 12.11.2026): a visit is checked by his position,
    // which is not taken then. He ends the break first.
    if (onBreakAt(driver, new Date())) throw new ConflictException('driver_on_break');
    if (!driver.vehicleId) throw new BadRequestException('driver_has_no_vehicle');
    const works = await this.resolveWorks(input.works, driver.id);
    if (input.center_id) await this.centerOrThrow(input.center_id);

    const row = await this.prisma.serviceVisit.create({
      data: {
        origin: input.origin,
        status: input.origin === 'emergency' ? 'in_progress' : 'requested',
        vehicleId: driver.vehicleId,
        driverId: driver.id,
        scheduledAt: input.scheduled_at ? new Date(input.scheduled_at) : null,
        note: input.note ?? null,
        orderId: input.order_id ?? null,
        selectedCenterId: input.center_id ?? null,
        startedAt: input.origin === 'emergency' ? new Date() : null,
        items: { create: works.map((w, i) => ({ ...w, position: i })) },
      },
      include: VISIT_INCLUDE,
    });
    if (input.origin === 'request') {
      await this.notifyStaff('service_request', "Servis so'rovi", `${row.driver?.user?.name ?? 'Haydovchi'} · ${row.vehicle.plateNumber}: ${works.map((w) => w.name).join(', ')}`);
    }
    return toVisit(row);
  }

  /** Admin sends a truck to service. Approved from the start; the driver sees a card. */
  async assignVisit(input: AssignServiceVisitInput, actor: Actor): Promise<ServiceVisit> {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: input.vehicle_id }, include: { driver: true } });
    if (!vehicle) throw new NotFoundException('vehicle_not_found');
    const works = await this.resolveWorks(input.works, null);
    if (input.center_id) await this.centerOrThrow(input.center_id);

    const row = await this.prisma.serviceVisit.create({
      data: {
        origin: 'assigned',
        status: 'approved',
        vehicleId: vehicle.id,
        driverId: vehicle.driver?.id ?? null,
        scheduledAt: new Date(input.scheduled_at),
        note: input.note ?? null,
        selectedCenterId: input.center_id ?? null,
        assignedById: actor.userId,
        decidedById: actor.userId,
        decidedAt: new Date(),
        items: { create: works.map((w, i) => ({ ...w, position: i })) },
      },
      include: VISIT_INCLUDE,
    });
    if (vehicle.driver) {
      await this.notifications.notify(vehicle.driver.userId, {
        type: 'service_assigned',
        title: 'Servisga yuborildingiz',
        body: `${works.map((w) => w.name).join(', ')} · ${fmtWhen(row.scheduledAt!)}`,
      });
    }
    return toVisit(row);
  }

  async approve(id: string, actor: Actor): Promise<ServiceVisit> {
    const v = await this.visitOrThrow(id);
    if (v.status !== 'requested') throw new ConflictException('service_visit_not_requested');
    const row = await this.prisma.serviceVisit.update({
      where: { id },
      data: { status: 'approved', decidedById: actor.userId, decidedAt: new Date() },
      include: VISIT_INCLUDE,
    });
    await this.notifyDriver(row, 'service_approved', 'Servis tasdiqlandi', `${itemNames(row)} · ${row.scheduledAt ? fmtWhen(row.scheduledAt) : ''}`);
    return toVisit(row);
  }

  async decline(id: string, input: DeclineServiceVisitInput, actor: Actor): Promise<ServiceVisit> {
    const v = await this.visitOrThrow(id);
    if (v.status !== 'requested') throw new ConflictException('service_visit_not_requested');
    const row = await this.prisma.serviceVisit.update({
      where: { id },
      data: { status: 'declined', decidedById: actor.userId, decidedAt: new Date(), declineReason: input.reason ?? null },
      include: VISIT_INCLUDE,
    });
    await this.notifyDriver(row, 'service_declined', 'Servis rad etildi', input.reason ? `${itemNames(row)} — ${input.reason}` : `${itemNames(row)} — boshqa sana tanlab qayta yuboring.`);
    return toVisit(row);
  }

  /**
   * The driver has arrived. Which centre they say, and where the phone says
   * — the fuel log's fence check decides between them. Nothing is refused.
   */
  async start(id: string, input: StartServiceVisitInput, actor: Actor): Promise<ServiceVisit> {
    const driver = await this.driverOf(actor);
    if (onBreakAt(driver, new Date())) throw new ConflictException('driver_on_break');
    const v = await this.visitOrThrow(id);
    if (v.driverId !== driver.id) throw new ForbiddenException('not_your_service_visit');
    if (v.status !== 'approved' && v.status !== 'in_progress') throw new ConflictException('service_visit_not_startable');
    if (v.status === 'in_progress' && v.capturedAt) throw new ConflictException('service_visit_already_started');
    if (input.center_id) await this.centerOrThrow(input.center_id);

    const centers = await this.prisma.serviceCenter.findMany({ where: { active: true } });
    const capturedAt = new Date(input.captured_at);
    const capture: TimedFix | null = input.position ? { lat: input.position.lat, lng: input.position.lng, at: capturedAt } : null;
    const tracked: TimedFix | null =
      driver.locationLat != null && driver.locationLng != null && driver.locationUpdatedAt
        ? { lat: driver.locationLat, lng: driver.locationLng, at: driver.locationUpdatedAt }
        : null;
    const verdict = classifyFill({ selectedStationId: input.center_id ?? null, capture, tracked, stations: centers });

    const row = await this.prisma.serviceVisit.update({
      where: { id },
      data: {
        status: 'in_progress',
        startedAt: v.startedAt ?? new Date(),
        selectedCenterId: input.center_id ?? null,
        resolvedCenterId: verdict.resolvedStationId,
        capturedAt,
        captureLat: capture?.lat ?? null,
        captureLng: capture?.lng ?? null,
        captureAccuracyM: input.position?.accuracy_m ?? null,
        trackedLat: tracked?.lat ?? null,
        trackedLng: tracked?.lng ?? null,
        trackedAt: tracked?.at ?? null,
        distanceM: verdict.distanceM,
        trackingGapM: verdict.trackingGapM,
        outcome: verdict.outcome,
        flags: verdict.flags,
      },
      include: VISIT_INCLUDE,
    });
    return toVisit(row);
  }

  /**
   * A photo of a work, in its slot — two per work (owner, 11.11.2026); an
   * older app sends no slot and fills the first. Replacing is allowed until
   * the visit is completed.
   */
  async itemPhoto(id: string, itemId: string, photoBase64: string, actor: Actor, slot = 0): Promise<ServiceVisit> {
    const driver = await this.driverOf(actor);
    const v = await this.visitOrThrow(id);
    if (v.driverId !== driver.id) throw new ForbiddenException('not_your_service_visit');
    if (v.status !== 'in_progress') throw new ConflictException('service_visit_not_in_progress');
    const item = v.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('service_item_not_found');
    const url = await this.upload.uploadBase64(photoBase64, 'service-visits');
    const urls = [...(item.photoUrls ?? [])];
    if (urls.length === 0 && item.photoUrl) urls.push(item.photoUrl);
    // A slot beyond the photos taken so far is the next one, never a gap.
    urls[Math.min(slot, urls.length)] = url;
    await this.prisma.serviceVisitItem.update({ where: { id: itemId }, data: { photoUrl: urls[0], photoUrls: urls } });
    return toVisit(await this.visitOrThrow(id));
  }

  /**
   * The receipt read before the visit is closed, so the driver sees the
   * total on it beside the one he types (owner, 11.11.2026). Null total when
   * the AI could not read it. Nothing is stored here; completing reads again.
   */
  async readReceipt(id: string, photoBase64: string, actor: Actor): Promise<{ total_sum: number | null }> {
    const driver = await this.driverOf(actor);
    const v = await this.visitOrThrow(id);
    if (v.driverId !== driver.id) throw new ForbiddenException('not_your_service_visit');
    if (v.status !== 'in_progress') throw new ConflictException('service_visit_not_in_progress');
    return { total_sum: this.receiptReader ? readTotal(await this.receiptReader.read(photoBase64)) : null };
  }

  /**
   * The list of works is not final until the visit is: the mechanic finds
   * one more thing, or a ticked work turns out not to be needed. The driver
   * edits their own open visit; the last work cannot be removed — a visit
   * with nothing done is cancelled, not emptied.
   */
  async addItem(id: string, work: AddServiceVisitItemInput, actor: Actor): Promise<ServiceVisit> {
    const driver = await this.driverOf(actor);
    const v = await this.visitOrThrow(id);
    if (v.driverId !== driver.id) throw new ForbiddenException('not_your_service_visit');
    if (!OPEN_STATUSES.includes(v.status)) throw new ConflictException('service_visit_closed');
    if (v.items.length >= 20) throw new BadRequestException('service_too_many_items');
    const [resolved] = await this.resolveWorks([work], driver.id);
    if (resolved!.reasonId && v.items.some((i) => i.reasonId === resolved!.reasonId)) {
      throw new ConflictException('service_item_duplicate');
    }
    await this.prisma.serviceVisitItem.create({
      data: { visitId: id, ...resolved!, position: Math.max(-1, ...v.items.map((i) => i.position)) + 1 },
    });
    return toVisit(await this.visitOrThrow(id));
  }

  async removeItem(id: string, itemId: string, actor: Actor): Promise<ServiceVisit> {
    const driver = await this.driverOf(actor);
    const v = await this.visitOrThrow(id);
    if (v.driverId !== driver.id) throw new ForbiddenException('not_your_service_visit');
    if (!OPEN_STATUSES.includes(v.status)) throw new ConflictException('service_visit_closed');
    if (!v.items.some((i) => i.id === itemId)) throw new NotFoundException('service_item_not_found');
    if (v.items.length <= 1) throw new ConflictException('service_last_item');
    await this.prisma.serviceVisitItem.delete({ where: { id: itemId } });
    return toVisit(await this.visitOrThrow(id));
  }

  /**
   * Closing the visit: every work photographed, the odometer, the total, a
   * receipt or the statement that there was none. Completing writes the km
   * to the vehicle and moves each work's schedule forward — which is what
   * makes the next reminder possible.
   */
  async complete(id: string, input: CompleteServiceVisitInput, actor: Actor): Promise<ServiceVisit> {
    const driver = await this.driverOf(actor);
    const v = await this.visitOrThrow(id);
    if (v.driverId !== driver.id) throw new ForbiddenException('not_your_service_visit');
    if (v.status !== 'in_progress') throw new ConflictException('service_visit_not_in_progress');
    if (!v.capturedAt) throw new ConflictException('service_visit_not_started');
    const missing = v.items.filter((i) => !i.photoUrl);
    if (missing.length) throw new BadRequestException({ message: 'service_items_missing_photo', items: missing.map((i) => i.id) });

    // A reading far ahead of the lorry's km is not refused (owner, 07.11.2026): the
    // visit is saved, the reading kept for the office to check, and the lorry's km
    // and the works' schedule stay on the km it had.
    //
    // The driver no longer types the odometer (owner, 11.11.2026): the work is
    // done at the lorry's km as the Monday photo left it. An older app still
    // sends a reading, which is handled as before.
    const current = (await this.prisma.vehicle.findUnique({ where: { id: v.vehicleId }, select: { currentKm: true } }))?.currentKm ?? null;
    const typedKm = input.odometer_km ?? null;
    const jump = typedKm != null && current != null && typedKm - current > KM_JUMP_MAX;
    const doneKm = typedKm == null || jump ? current : typedKm;

    const receiptUrl = input.receipt_photo_base64 ? await this.upload.uploadBase64(input.receipt_photo_base64, 'service-receipts') : null;
    // The total on the receipt, read by the AI and kept beside the typed one (owner, 11.11.2026).
    const receiptReadSum = input.receipt_photo_base64 && this.receiptReader ? readTotal(await this.receiptReader.read(input.receipt_photo_base64)) : null;
    const costs = new Map((input.item_costs ?? []).map((c) => [c.item_id, c.cost_sum]));
    const now = new Date();

    const row = await this.prisma.$transaction(async (tx) => {
      // Claim it first: a second tap passed the status check above too, and
      // wrote a second km record and a wrong remainingKmAtVisit (audit, 07.11.2026).
      const claim = await tx.serviceVisit.updateMany({ where: { id, status: 'in_progress' }, data: { status: 'completed' } });
      if (claim.count === 0) throw new ConflictException('service_visit_not_in_progress');
      for (const it of v.items) {
        if (costs.has(it.id)) await tx.serviceVisitItem.update({ where: { id: it.id }, data: { costSum: costs.get(it.id)! } });
        if (it.reasonId && doneKm != null) {
          // How early or late against its due point (owner, 06.11.2026), read
          // before the state moves on to this visit.
          const [prev, reason] = await Promise.all([
            tx.vehicleServiceState.findUnique({ where: { vehicleId_reasonId: { vehicleId: v.vehicleId, reasonId: it.reasonId } } }),
            tx.serviceReason.findUnique({ where: { id: it.reasonId }, select: { intervalKm: true } }),
          ]);
          if (prev && reason?.intervalKm) {
            await tx.serviceVisitItem.update({
              where: { id: it.id },
              data: { remainingKmAtVisit: prev.lastDoneKm + reason.intervalKm - doneKm },
            });
          }
          await tx.vehicleServiceState.upsert({
            where: { vehicleId_reasonId: { vehicleId: v.vehicleId, reasonId: it.reasonId } },
            create: { vehicleId: v.vehicleId, reasonId: it.reasonId, lastDoneKm: doneKm, lastDoneAt: now, lastVisitId: v.id },
            update: { lastDoneKm: doneKm, lastDoneAt: now, lastVisitId: v.id },
          });
        }
      }
      // A typed odometer is a km reading like any other; the vehicle's current km moves with it.
      if (typedKm != null) {
        await tx.kmRecord.create({ data: { vehicleId: v.vehicleId, km: typedKm, recordedById: actor.userId, needsReview: jump } });
        const veh = await tx.vehicle.findUnique({ where: { id: v.vehicleId }, select: { currentKm: true } });
        if (!jump && (veh?.currentKm ?? 0) < typedKm) {
          await tx.vehicle.update({ where: { id: v.vehicleId }, data: { currentKm: typedKm } });
        }
      }
      return tx.serviceVisit.update({
        where: { id },
        data: {
          status: 'completed',
          completedAt: now,
          // A typed reading is kept as typed, even one flagged for review.
          odometerKm: typedKm ?? doneKm,
          totalSum: input.total_sum,
          receiptPhotoUrl: receiptUrl,
          receiptReadSum,
          noReceipt: input.no_receipt,
          driverComment: input.comment?.trim() || null,
          settlement: v.outcome ? DEFAULT_SETTLEMENT[v.outcome as FuelLogOutcome] : null,
        },
        include: VISIT_INCLUDE,
      });
    });
    // The photos go to the service group as they used to by hand. The visit
    // is saved either way: a Telegram hiccup is retried, never shown to the driver.
    void this.telegram.createForServiceVisit(row).catch((err: Error) => this.logger.warn(`telegram service report failed: ${err.message}`));
    this.syncExpense(row.id);
    if (jump) {
      await notifyKmJump(this.prisma, this.notifications, {
        plate: row.vehicle.plateNumber,
        recordedById: actor.userId,
        km: typedKm!,
        previousKm: current!,
      }).catch((err: Error) => this.logger.warn(`km review notice failed: ${err.message}`));
    }
    return toVisit(row);
  }

  /**
   * A driver may drop their own plan: a request still waiting or already
   * approved, or an emergency opened by mistake before any photo was taken.
   * What admin assigned is admin's to cancel. Staff are told when a visit
   * they had said yes to goes away.
   */
  async cancel(id: string, actor: Actor): Promise<ServiceVisit> {
    const v = await this.visitOrThrow(id);
    if (actor.role === 'driver') {
      const driver = await this.driverOf(actor);
      if (v.driverId !== driver.id) throw new ForbiddenException('not_your_service_visit');
      const untouched = v.origin === 'emergency' && v.status === 'in_progress' && v.items.every((i) => !i.photoUrl);
      const ownPlan = v.origin !== 'assigned' && (v.status === 'requested' || v.status === 'approved');
      if (!untouched && !ownPlan) throw new ConflictException('service_visit_not_cancellable');
    } else if (v.status === 'completed' || v.status === 'cancelled') {
      throw new ConflictException('service_visit_not_cancellable');
    }
    const row = await this.prisma.serviceVisit.update({ where: { id }, data: { status: 'cancelled' }, include: VISIT_INCLUDE });
    if (actor.role === 'driver' && v.status === 'approved') {
      await this.notifyStaff('service_cancelled', 'Servis bekor qilindi', `${row.driver?.user?.name ?? 'Haydovchi'} · ${row.vehicle.plateNumber}: ${itemNames(row)} — haydovchi bekor qildi.`);
    }
    this.syncExpense(row.id);
    return toVisit(row);
  }

  async myVisits(actor: Actor): Promise<ServiceVisit[]> {
    const driver = await this.driverOf(actor);
    const rows = await this.prisma.serviceVisit.findMany({
      where: { driverId: driver.id },
      include: VISIT_INCLUDE,
      orderBy: [{ status: 'asc' }, { scheduledAt: 'asc' }, { createdAt: 'desc' }],
      take: 50,
    });
    return rows.map(toVisit);
  }

  async getVisit(id: string, actor: Actor): Promise<ServiceVisit> {
    const v = await this.visitOrThrow(id);
    if (actor.role === 'driver') {
      const driver = await this.driverOf(actor);
      if (v.driverId !== driver.id) throw new ForbiddenException('not_your_service_visit');
    }
    return toVisit(v);
  }

  async listVisits(f: {
    vehicle_id?: string; driver_id?: string; center_id?: string; reason_id?: string;
    origin?: string; status?: string; settlement_state?: FuelSettlementState;
  } & Period): Promise<ServiceVisit[]> {
    const rows = await this.prisma.serviceVisit.findMany({
      where: {
        ...(f.vehicle_id ? { vehicleId: f.vehicle_id } : {}),
        ...(f.driver_id ? { driverId: f.driver_id } : {}),
        ...(f.center_id ? { resolvedCenterId: f.center_id } : {}),
        ...(f.reason_id ? { items: { some: { reasonId: f.reason_id } } } : {}),
        ...(f.origin ? { origin: f.origin as never } : {}),
        ...(f.status ? { status: f.status as never } : {}),
        ...(f.settlement_state ? { status: 'completed', ...SETTLEMENT_STATE_WHERE[f.settlement_state] } : {}),
        // Period means the same thing here as in the totals below: when the
        // visit was completed. A visit opened in September and finished in
        // October belongs to October on both the list and the invoice.
        ...(f.from || f.to
          ? {
              OR: [
                { completedAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } },
                { completedAt: null, createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } },
              ],
            }
          : {}),
      },
      include: VISIT_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return rows.map(toVisit);
  }

  async correctTotal(id: string, input: CorrectServiceTotalInput, actor: Actor): Promise<ServiceVisit> {
    const v = await this.visitOrThrow(id);
    if (v.status !== 'completed') throw new ConflictException('service_visit_not_completed');
    if (v.settledAt) throw new ConflictException('service_visit_already_paid');
    // Not once it is paid, even if the payment landed after the read above (audit, 07.11.2026).
    const { count } = await this.prisma.serviceVisit.updateMany({
      where: { id, settledAt: null },
      data: {
        totalSum: input.total_sum,
        ...(v.originalTotalSum == null ? { originalTotalSum: v.totalSum } : {}),
        reviewedById: actor.userId,
        reviewedAt: new Date(),
      },
    });
    if (count === 0) throw new ConflictException('service_visit_already_paid');
    this.syncExpense(id);
    return toVisit(await this.visitOrThrow(id));
  }

  /** Mark who pays. An invoice can only be addressed to a centre we deal with. */
  async settle(id: string, input: SettleServiceVisitInput): Promise<ServiceVisit> {
    const v = await this.visitOrThrow(id);
    if (v.status !== 'completed') throw new ConflictException('service_visit_not_completed');
    if (v.settledAt) throw new ConflictException('service_visit_already_paid');
    const centerId = input.settlement === 'station_invoice' ? (input.center_id ?? v.resolvedCenterId) : null;
    if (input.settlement === 'station_invoice') {
      if (!centerId) throw new BadRequestException('center_required');
      await this.centerOrThrow(centerId);
    }
    const { count } = await this.prisma.serviceVisit.updateMany({
      where: { id, settledAt: null }, // (audit, 07.11.2026)
      data: { settlement: input.settlement, ...(centerId ? { resolvedCenterId: centerId } : {}) },
    });
    if (count === 0) throw new ConflictException('service_visit_already_paid');
    return toVisit(await this.visitOrThrow(id));
  }

  // ------------------------------------------------------------------ month-end

  async summary(period: Period): Promise<ServiceSummary> {
    const [dueItems, pendingRequests, pendingReview, visits] = await Promise.all([
      this.due(),
      this.prisma.serviceVisit.count({ where: { status: 'requested' } }),
      this.prisma.serviceVisit.count({ where: { status: 'completed', settlement: null } }),
      this.prisma.serviceVisit.findMany({
        where: { status: 'completed', ...(period.from || period.to ? { completedAt: { ...(period.from ? { gte: period.from } : {}), ...(period.to ? { lte: period.to } : {}) } } : {}) },
        select: { totalSum: true },
      }),
    ]);
    return {
      overdue: dueItems.filter((d) => d.remaining_km != null && d.remaining_km < 0).length,
      due_soon: dueItems.filter((d) => d.remaining_km != null && d.remaining_km >= 0 && d.remaining_km <= 1_000).length,
      pending_requests: pendingRequests,
      pending_review: pendingReview,
      visits: visits.length,
      total_sum: round1(visits.reduce((s, v) => s + (v.totalSum ?? 0), 0)),
    };
  }

  async centerTotals(period: Period): Promise<ServiceCenterTotal[]> {
    const rows = await this.prisma.serviceVisit.findMany({
      where: {
        status: 'completed', settlement: 'station_invoice', resolvedCenterId: { not: null },
        ...(period.from || period.to ? { completedAt: { ...(period.from ? { gte: period.from } : {}), ...(period.to ? { lte: period.to } : {}) } } : {}),
      },
      select: { resolvedCenterId: true, totalSum: true },
    });
    const acc = new Map<string, { count: number; sum: number }>();
    for (const r of rows) {
      const a = acc.get(r.resolvedCenterId!) ?? { count: 0, sum: 0 };
      a.count += 1; a.sum += r.totalSum ?? 0; acc.set(r.resolvedCenterId!, a);
    }
    const centers = await this.prisma.serviceCenter.findMany({ where: { id: { in: [...acc.keys()] } } });
    return centers
      .flatMap((c) => { const a = acc.get(c.id); return a ? [{ center: toCenter(c), count: a.count, total_sum: round1(a.sum) }] : []; })
      .sort((a, b) => b.total_sum - a.total_sum);
  }

  async driverDebts(): Promise<ServiceDriverDebt[]> {
    const rows = await this.prisma.serviceVisit.findMany({
      where: { status: 'completed', settlement: 'driver_reimbursement', settledAt: null, driverId: { not: null } },
      include: { driver: { select: { user: { select: { name: true } } } }, vehicle: { select: { plateNumber: true } } },
      orderBy: { completedAt: 'asc' },
    });
    const by = new Map<string, ServiceDriverDebt>();
    for (const r of rows) {
      const cur = by.get(r.driverId!);
      if (cur) { cur.count += 1; cur.total_sum = round1(cur.total_sum + (r.totalSum ?? 0)); }
      else by.set(r.driverId!, { driver_id: r.driverId!, driver_name: r.driver?.user?.name ?? null, vehicle_plate: r.vehicle.plateNumber, count: 1, total_sum: round1(r.totalSum ?? 0), oldest_at: (r.completedAt ?? r.createdAt).toISOString() });
    }
    return [...by.values()].sort((a, b) => b.total_sum - a.total_sum);
  }

  async payDriver(driverId: string, upTo: Date): Promise<{ paid: number; total_sum: number }> {
    const due = await this.prisma.serviceVisit.findMany({
      where: { driverId, status: 'completed', settlement: 'driver_reimbursement', settledAt: null, completedAt: { lte: upTo } },
      select: { id: true, totalSum: true },
    });
    if (due.length === 0) return { paid: 0, total_sum: 0 };
    // Only rows still unpaid, and the answer counts only what this call paid:
    // two taps used to pay twice (audit, 07.11.2026).
    const now = new Date();
    const ids = due.map((d) => d.id);
    const { count } = await this.prisma.serviceVisit.updateMany({ where: { id: { in: ids }, settledAt: null }, data: { settledAt: now } });
    if (count === 0) return { paid: 0, total_sum: 0 };
    const paid = await this.prisma.serviceVisit.findMany({ where: { id: { in: ids }, settledAt: now }, select: { totalSum: true } });
    return { paid: paid.length, total_sum: round1(paid.reduce((s, d) => s + (d.totalSum ?? 0), 0)) };
  }

  // ------------------------------------------------------------------ helpers

  private async resolveWorks(
    works: CreateServiceVisitInput['works'],
    driverId: string | null,
  ): Promise<{ reasonId: string | null; name: string }[]> {
    const ids = works.flatMap((w) => ('reason_id' in w ? [w.reason_id] : []));
    const reasons = ids.length
      ? await this.prisma.serviceReason.findMany({ where: { id: { in: ids }, active: true } })
      : [];
    const byId = new Map(reasons.map((r) => [r.id, r]));
    const out: { reasonId: string | null; name: string }[] = [];
    for (const w of works) {
      if ('reason_id' in w) {
        const r = byId.get(w.reason_id);
        if (!r) throw new BadRequestException('service_reason_not_found');
        // A driver may use the catalogue or their own suggestions, nobody else's.
        if (!r.approved && r.createdByDriverId !== driverId) throw new BadRequestException('service_reason_not_found');
        out.push({ reasonId: r.id, name: r.name });
      } else {
        // Typed on the spot: becomes a pending reason too, so it can be promoted later.
        // Starts with a capital however it was typed (owner, 11.11.2026).
        const name = w.custom_name.trim().replace(/^\p{Ll}/u, (c) => c.toUpperCase());
        const r = await this.prisma.serviceReason.create({ data: { name, approved: false, createdByDriverId: driverId } });
        out.push({ reasonId: r.id, name: r.name });
      }
    }
    return out;
  }

  private async centerOrThrow(id: string) {
    const c = await this.prisma.serviceCenter.findUnique({ where: { id } });
    if (!c || !c.active) throw new BadRequestException('service_center_not_found');
    return c;
  }

  private async visitOrThrow(id: string): Promise<VisitRow> {
    const v = await this.prisma.serviceVisit.findUnique({ where: { id }, include: VISIT_INCLUDE });
    if (!v) throw new NotFoundException('service_visit_not_found');
    return v;
  }

  private async driverOf(actor: Actor) {
    const driver = await this.prisma.driver.findUnique({ where: { userId: actor.userId } });
    if (!driver) throw new ForbiddenException('driver_only');
    return driver;
  }

  private async notifyDriver(v: VisitRow, type: string, title: string, body: string) {
    if (!v.driverId) return;
    const d = await this.prisma.driver.findUnique({ where: { id: v.driverId }, select: { userId: true } });
    if (d) await this.notifications.notify(d.userId, { type, title, body });
  }

  private async notifyStaff(type: string, title: string, body: string) {
    const staff = await this.prisma.user.findMany({ where: { role: { in: ['admin', 'manager'] }, status: 'active' }, select: { id: true } });
    if (staff.length) await this.notifications.notifyMany(staff.map((s) => s.id), { type, title, body });
  }
}

// ---------------------------------------------------------------- mapping

function assertPinnedOrUnpinned(p: { lat?: number | null; lng?: number | null }): void {
  if ((p.lat == null) !== (p.lng == null)) throw new BadRequestException('service_center_half_pinned');
}
function centerData(input: CreateServiceCenterInput | UpdateServiceCenterInput) {
  return {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.brand !== undefined ? { brand: input.brand ?? null } : {}),
    ...(input.address !== undefined ? { address: input.address ?? null } : {}),
    ...(input.lat !== undefined ? { lat: input.lat ?? null } : {}),
    ...(input.lng !== undefined ? { lng: input.lng ?? null } : {}),
    ...(input.contracted !== undefined ? { contracted: input.contracted } : {}),
    ...(input.active !== undefined ? { active: input.active } : {}),
  } as Prisma.ServiceCenterUncheckedCreateInput;
}
function toCenter(r: CenterRow): ServiceCenter {
  return { id: r.id, name: r.name, brand: r.brand, address: r.address, lat: r.lat, lng: r.lng, contracted: r.contracted, active: r.active };
}
function toReason(r: ReasonRow & { createdByDriver?: { user: { name: string } | null } | null }): ServiceReason {
  return {
    id: r.id, name: r.name, interval_km: r.intervalKm, active: r.active, approved: r.approved,
    created_by_driver_name: r.createdByDriver?.user?.name ?? null, created_at: r.createdAt.toISOString(),
  };
}
function toVisit(r: VisitRow): ServiceVisit {
  return {
    id: r.id,
    status: r.status,
    origin: r.origin,
    vehicle_id: r.vehicleId,
    vehicle_plate: r.vehicle?.plateNumber ?? null,
    vehicle_model: r.vehicle?.model ?? null,
    driver_id: r.driverId,
    driver_name: r.driver?.user?.name ?? null,
    items: r.items.map((i) => ({ id: i.id, reason_id: i.reasonId, name: i.name, photo_url: i.photoUrl, photo_urls: i.photoUrls?.length ? i.photoUrls : i.photoUrl ? [i.photoUrl] : [], cost_sum: i.costSum, remaining_km_at_visit: i.remainingKmAtVisit })),
    scheduled_at: r.scheduledAt ? r.scheduledAt.toISOString() : null,
    note: r.note,
    order_id: r.orderId,
    order_number: r.order?.orderNumber ?? null,
    client_name: r.order?.clientName ?? null,
    requested_at: r.requestedAt.toISOString(),
    decided_at: r.decidedAt ? r.decidedAt.toISOString() : null,
    decided_by_name: r.decidedBy?.name ?? null,
    decline_reason: r.declineReason ?? null,
    assigned_by_name: r.assignedBy?.name ?? null,
    started_at: r.startedAt ? r.startedAt.toISOString() : null,
    completed_at: r.completedAt ? r.completedAt.toISOString() : null,
    selected_center: r.selectedCenter ? toCenter(r.selectedCenter) : null,
    resolved_center: r.resolvedCenter ? toCenter(r.resolvedCenter) : null,
    outcome: (r.outcome as FuelLogOutcome | null) ?? null,
    flags: r.flags as FuelLogFlag[],
    distance_m: r.distanceM,
    capture: r.captureLat != null && r.captureLng != null ? { lat: r.captureLat, lng: r.captureLng, accuracy_m: r.captureAccuracyM } : null,
    tracked: r.trackedLat != null && r.trackedLng != null && r.trackedAt ? { lat: r.trackedLat, lng: r.trackedLng, at: r.trackedAt.toISOString() } : null,
    odometer_km: r.odometerKm,
    total_sum: r.totalSum,
    original_total_sum: r.originalTotalSum,
    receipt_photo_url: r.receiptPhotoUrl,
    receipt_read_sum: r.receiptReadSum ?? null,
    no_receipt: r.noReceipt,
    driver_comment: r.driverComment ?? null,
    reviewed_by_name: r.reviewedBy?.name ?? null,
    reviewed_at: r.reviewedAt ? r.reviewedAt.toISOString() : null,
    settlement: r.settlement,
    settled_at: r.settledAt ? r.settledAt.toISOString() : null,
    created_at: r.createdAt.toISOString(),
  };
}
function itemNames(v: VisitRow): string { return v.items.map((i) => i.name).join(', '); }
const round1 = (n: number) => Math.round(n * 10) / 10;
const fmtKm = (n: number) => Math.round(n).toLocaleString('ru-RU');
const fmtWhen = (d: Date) => d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' });
