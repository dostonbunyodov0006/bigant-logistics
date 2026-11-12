import { tashkentDateKey } from '../common/tashkent-time';
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Incident, Driver, KmRecord, User, Vehicle, VehicleDocument } from '@prisma/client';
import {
  DEFAULT_PAGE_SIZE,
  type Page,
  type VehicleFilterInput,
  type CreateVehicleDocumentInput,
  type CreateVehicleInput,
  type IncidentPublic,
  type IncidentType,
  type KmRecordPublic,
  type UpdateVehicleDocumentInput,
  type UpdateVehicleInput,
  type VehicleCategory,
  type VehicleDocType,
  type VehicleDocumentPublic,
  type VehiclePublic,
  type VehicleStatus,
  type VehicleType,
} from '@bigant/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { namesOnPaper, sameDriverName } from './poa-match';

/** Parse a YYYY-MM-DD string as a UTC date. */
function toDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

type VehicleWithDriver = Vehicle & {
  driver?: (Driver & { user: User }) | null;
  documents?: VehicleDocument[];
};

// Include the assigned driver (to hide taken vehicles / show the owner) and the
// documents (to flag expiry on list views).
const VEHICLE_INCLUDE = { driver: { include: { user: true } }, documents: true };

/** Days within which a document counts as "expiring soon". */
const EXPIRY_SOON_DAYS = 30;

function docsExpiryAlert(docs: VehicleDocument[] | undefined): 'expired' | 'soon' | null {
  if (!docs?.length) {
    return null;
  }
  const now = Date.now();
  const soonMs = EXPIRY_SOON_DAYS * 86_400_000;
  let alert: 'expired' | 'soon' | null = null;
  for (const d of docs) {
    const diff = d.expiresAt.getTime() - now;
    if (diff < 0) {
      return 'expired'; // most severe — no need to look further
    }
    if (diff <= soonMs) {
      alert = 'soon';
    }
  }
  return alert;
}

/** The most a reading may run ahead of the vehicle's current km (audit, 07.11.2026). */
export const KM_JUMP_MAX = 10_000;

const kmNum = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** What admins and managers are told of a driver's km far above the lorry's (owner, 07.11.2026). */
export function kmJumpMessage(i: { plate: string; driverName: string | null; km: number; previousKm: number }): string {
  const who = i.driverName ? `${i.plate} (${i.driverName})` : i.plate;
  return (
    `${who}: spidometrda ${kmNum(i.km)} km kiritildi, oldingisi ${kmNum(i.previousKm)} km — farq ${kmNum(i.km - i.previousKm)} km. ` +
    "Rasmni tekshirib, to'g'ri km'ni Transport → mashina sahifasida kiriting."
  );
}

/** Tell every active admin and manager — site bell and phone (owner, 07.11.2026). */
export async function notifyKmJump(
  prisma: PrismaService,
  notifications: NotificationsService,
  i: { plate: string; recordedById: string | null; km: number; previousKm: number },
): Promise<void> {
  const [staff, who] = await Promise.all([
    prisma.user.findMany({ where: { role: { in: ['admin', 'manager'] }, status: 'active' }, select: { id: true } }),
    i.recordedById ? prisma.user.findUnique({ where: { id: i.recordedById }, select: { name: true } }) : null,
  ]);
  if (!staff.length) return;
  await notifications.notifyMany(
    staff.map((s) => s.id),
    {
      type: 'km_needs_review',
      title: "Spidometrni tekshiring",
      body: kmJumpMessage({ plate: i.plate, driverName: who?.name ?? null, km: i.km, previousKm: i.previousKm }),
    },
  );
}

@Injectable()
export class VehiclesService {
  private readonly logger = new Logger(VehiclesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * The drivers a power of attorney in force names for this lorry — the only
   * ones the office may put on it. Matched by name, the way the paper spells it.
   */
  async authorizedDrivers(id: string): Promise<{ has_poa: boolean; driver_ids: string[] }> {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id }, select: { id: true } });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    // Tashkent's today, not UTC's (until 05:00 it was still yesterday).
    const today = new Date(`${tashkentDateKey(new Date())}T00:00:00.000Z`);
    const papers = await this.prisma.vehicleDocument.findMany({
      where: { vehicleId: id, type: 'power_of_attorney', expiresAt: { gte: today } },
      select: { holderName: true },
    });
    const names = papers.flatMap((p) => namesOnPaper(p.holderName));
    if (names.length === 0) return { has_poa: false, driver_ids: [] };
    const drivers = await this.prisma.driver.findMany({ select: { id: true, user: { select: { name: true } } } });
    const ids = drivers.filter((d) => d.user && names.some((n) => sameDriverName(n, d.user!.name))).map((d) => d.id);
    return { has_poa: true, driver_ids: ids };
  }

  private buildWhere(search?: string) {
    const q = search?.trim();
    return q
      ? {
          OR: [
            { plateNumber: { contains: q, mode: 'insensitive' as const } },
            { model: { contains: q, mode: 'insensitive' as const } },
            { techPassport: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {};
  }

  /** Bounded: this used to return the whole fleet in one response. */
  async findAll(filters: VehicleFilterInput = {}): Promise<VehiclePublic[]> {
    const vehicles = await this.prisma.vehicle.findMany({
      where: { ...this.buildWhere(filters.search), status: { not: 'inactive' } },
      include: VEHICLE_INCLUDE,
      orderBy: { createdAt: 'desc' },
      skip: filters.skip ?? 0,
      take: filters.take ?? DEFAULT_PAGE_SIZE,
    });
    return vehicles.map((v) => this.toPublic(v));
  }

  async findPage(filters: VehicleFilterInput): Promise<Page<VehiclePublic>> {
    const where = this.buildWhere(filters.search);
    const [vehicles, total] = await Promise.all([
      this.prisma.vehicle.findMany({
        where,
        include: VEHICLE_INCLUDE,
        // Switched-off lorries go to the bottom.
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip: filters.skip ?? 0,
        take: filters.take ?? DEFAULT_PAGE_SIZE,
      }),
      this.prisma.vehicle.count({ where }),
    ]);
    return { items: vehicles.map((v) => this.toPublic(v)), total };
  }

  async findOne(id: string): Promise<VehiclePublic> {
    return this.toPublic(await this.getOrThrow(id));
  }

  async create(input: CreateVehicleInput): Promise<VehiclePublic> {
    await this.assertPlateFree(input.plate_number);
    const vehicle = await this.prisma.vehicle.create({
      data: {
        plateNumber: input.plate_number,
        model: input.model,
        techPassport: input.tech_passport ?? null,
        owner: input.owner ?? null,
        modelYear: input.model_year ?? null,
        type: input.type,
        capacityKg: input.capacity_kg ?? null,
        lengthCm: input.length_cm ?? null,
        widthCm: input.width_cm ?? null,
        heightCm: input.height_cm ?? null,
        category: input.category ?? null,
        notes: input.notes ?? null,
      },
      include: VEHICLE_INCLUDE,
    });
    return this.toPublic(vehicle);
  }

  async update(id: string, input: UpdateVehicleInput): Promise<VehiclePublic> {
    const existing = await this.getOrThrow(id);
    if (input.plate_number && input.plate_number !== existing.plateNumber) {
      await this.assertPlateFree(input.plate_number);
    }
    const vehicle = await this.prisma.vehicle.update({
      where: { id },
      data: {
        ...(input.plate_number !== undefined && { plateNumber: input.plate_number }),
        ...(input.model !== undefined && { model: input.model }),
        ...(input.tech_passport !== undefined && { techPassport: input.tech_passport }),
        ...(input.owner !== undefined && { owner: input.owner }),
        ...(input.model_year !== undefined && { modelYear: input.model_year }),
        ...(input.type !== undefined && { type: input.type }),
        ...(input.capacity_kg !== undefined && { capacityKg: input.capacity_kg }),
        ...(input.length_cm !== undefined && { lengthCm: input.length_cm }),
        ...(input.width_cm !== undefined && { widthCm: input.width_cm }),
        ...(input.height_cm !== undefined && { heightCm: input.height_cm }),
        ...(input.category !== undefined && { category: input.category }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.notes !== undefined && { notes: input.notes }),
      },
      include: VEHICLE_INCLUDE,
    });
    return this.toPublic(vehicle);
  }

  /** A lorry is never deleted: its expenses, service visits, km, incidents,
   *  papers and bookings stay. It is switched off and loses its driver, so it
   *  leaves the pickers and the seller board (owner, 29.10.2026). */
  async remove(id: string): Promise<{ deleted: true }> {
    await this.getOrThrow(id);
    await this.prisma.$transaction([
      this.prisma.driver.updateMany({ where: { vehicleId: id }, data: { vehicleId: null } }),
      this.prisma.vehicle.update({ where: { id }, data: { status: 'inactive' } }),
    ]);
    return { deleted: true };
  }

  /**
   * Record an odometer reading; also updates the vehicle's denormalized current km.
   * `office`: an admin/manager on the vehicle page (owner, 07.11.2026).
   */
  async logKm(
    vehicleId: string,
    km: number,
    recordedById: string | null,
    photoUrl: string | null = null,
    check: { aiKm: number | null; status: string } | null = null,
    opts: { office?: boolean } = {},
  ): Promise<KmRecordPublic> {
    const vehicle = await this.getOrThrow(vehicleId);
    // An odometer only goes up: a smaller number is a typo, and taking it
    // would wind back every service due date.
    if (vehicle.currentKm != null && km < vehicle.currentKm) {
      throw new ConflictException('km_less_than_previous');
    }
    // A driver's reading more than 10 000 km ahead (1 234 567 for 123 456) is
    // kept, flagged and sent to the office, but not taken as the lorry's km;
    // he goes on working (owner, 07.11.2026). The office's own entry is taken
    // as it is and clears the flags — that is how a wrong reading is put right.
    const jump = !opts.office && vehicle.currentKm != null && km - vehicle.currentKm > KM_JUMP_MAX;
    const record = await this.prisma.$transaction(async (tx) => {
      const r = await tx.kmRecord.create({
        data: { vehicleId, km, recordedById, photoUrl, aiKm: check?.aiKm ?? null, checkStatus: check?.status ?? null, needsReview: jump },
      });
      if (!jump) await tx.vehicle.update({ where: { id: vehicleId }, data: { currentKm: km } });
      if (opts.office) await tx.kmRecord.updateMany({ where: { vehicleId, needsReview: true }, data: { needsReview: false } });
      return r;
    });
    if (jump) {
      // The reading is saved either way; a failed notice is only logged.
      await notifyKmJump(this.prisma, this.notifications, {
        plate: vehicle.plateNumber,
        recordedById,
        km,
        previousKm: vehicle.currentKm!,
      }).catch((err: Error) => this.logger.warn(`km review notice failed: ${err.message}`));
    }
    return this.kmToPublic(record);
  }

  /** Odometer history for a vehicle, most recent first. */
  async listKm(vehicleId: string): Promise<KmRecordPublic[]> {
    await this.getOrThrow(vehicleId);
    const records = await this.prisma.kmRecord.findMany({
      where: { vehicleId },
      orderBy: { recordedAt: 'desc' },
      take: 100,
    });
    return records.map((r) => this.kmToPublic(r));
  }

  // --- Vehicle documents (tech inspection, insurance, etc.) ---

  async listDocuments(vehicleId: string): Promise<VehicleDocumentPublic[]> {
    await this.getOrThrow(vehicleId);
    const docs = await this.prisma.vehicleDocument.findMany({
      where: { vehicleId },
      orderBy: { expiresAt: 'asc' },
    });
    return docs.map((d) => this.docToPublic(d));
  }

  async addDocument(
    vehicleId: string,
    input: CreateVehicleDocumentInput,
  ): Promise<VehicleDocumentPublic> {
    await this.getOrThrow(vehicleId);
    const doc = await this.prisma.vehicleDocument.create({
      data: {
        vehicleId,
        type: input.type,
        number: input.number ?? null,
        issuedAt: input.issued_at ? toDate(input.issued_at) : null,
        expiresAt: toDate(input.expires_at),
        holderName: input.holder_name ?? null,
        notes: input.notes ?? null,
      },
    });
    return this.docToPublic(doc);
  }

  async updateDocument(
    vehicleId: string,
    docId: string,
    input: UpdateVehicleDocumentInput,
  ): Promise<VehicleDocumentPublic> {
    await this.getDocOrThrow(vehicleId, docId);
    const doc = await this.prisma.vehicleDocument.update({
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
        ...(input.holder_name !== undefined && { holderName: input.holder_name }),
        ...(input.notes !== undefined && { notes: input.notes }),
      },
    });
    return this.docToPublic(doc);
  }

  async removeDocument(vehicleId: string, docId: string): Promise<{ deleted: true }> {
    await this.getDocOrThrow(vehicleId, docId);
    await this.prisma.vehicleDocument.delete({ where: { id: docId } });
    return { deleted: true };
  }

  private async getDocOrThrow(vehicleId: string, docId: string): Promise<VehicleDocument> {
    const doc = await this.prisma.vehicleDocument.findUnique({ where: { id: docId } });
    if (!doc || doc.vehicleId !== vehicleId) {
      throw new NotFoundException('Vehicle document not found');
    }
    return doc;
  }

  // --- Incidents (accidents, breakdowns, …) ---

  async listIncidents(vehicleId: string): Promise<IncidentPublic[]> {
    await this.getOrThrow(vehicleId);
    const incidents = await this.prisma.incident.findMany({
      where: { vehicleId },
      orderBy: { occurredAt: 'desc' },
      include: { order: { select: { orderNumber: true, clientName: true } } },
    });
    return incidents.map((i) => this.incidentToPublic(i));
  }

  async addIncident(
    vehicleId: string,
    input: { type: IncidentType; description?: string; occurred_at?: string; order_id?: string },
    reportedById: string | null = null,
  ): Promise<IncidentPublic> {
    await this.getOrThrow(vehicleId);
    const incident = await this.prisma.incident.create({
      data: {
        vehicleId,
        orderId: input.order_id ?? null,
        type: input.type,
        description: input.description ?? null,
        occurredAt: input.occurred_at ? toDate(input.occurred_at) : new Date(),
        reportedById,
      },
      include: { order: { select: { orderNumber: true, clientName: true } } },
    });
    return this.incidentToPublic(incident);
  }

  async removeIncident(vehicleId: string, incidentId: string): Promise<{ deleted: true }> {
    const incident = await this.prisma.incident.findUnique({ where: { id: incidentId } });
    if (!incident || incident.vehicleId !== vehicleId) {
      throw new NotFoundException('Incident not found');
    }
    await this.prisma.incident.delete({ where: { id: incidentId } });
    return { deleted: true };
  }

  private incidentToPublic(i: Incident & { order?: { orderNumber: number; clientName: string } | null }): IncidentPublic {
    return {
      id: i.id,
      vehicle_id: i.vehicleId,
      order_id: i.orderId,
      order_number: i.order?.orderNumber ?? null,
      client_name: i.order?.clientName ?? null,
      type: i.type as IncidentType,
      description: i.description,
      occurred_at: i.occurredAt.toISOString(),
      reported_by: i.reportedById,
      created_at: i.createdAt.toISOString(),
    };
  }

  private async assertPlateFree(plateNumber: string): Promise<void> {
    const existing = await this.prisma.vehicle.findUnique({ where: { plateNumber } });
    if (existing) {
      throw new ConflictException('plate_already_registered');
    }
  }

  private async getOrThrow(id: string): Promise<VehicleWithDriver> {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id }, include: VEHICLE_INCLUDE });
    if (!vehicle) {
      throw new NotFoundException('Vehicle not found');
    }
    return vehicle;
  }

  private toPublic(v: VehicleWithDriver): VehiclePublic {
    return {
      id: v.id,
      plate_number: v.plateNumber,
      model: v.model,
      tech_passport: v.techPassport,
      owner: v.owner,
      tech_passport_front_url: v.techPassportFrontUrl,
      tech_passport_back_url: v.techPassportBackUrl,
      model_year: v.modelYear,
      type: v.type as VehicleType,
      capacity_kg: v.capacityKg,
      length_cm: v.lengthCm,
      width_cm: v.widthCm,
      height_cm: v.heightCm,
      category: v.category as VehicleCategory | null,
      status: v.status as VehicleStatus,
      notes: v.notes,
      current_km: v.currentKm,
      assigned_driver_id: v.driver?.id ?? null,
      assigned_driver_name: v.driver?.user?.name ?? null,
      assigned_driver_phone: v.driver?.user?.phoneNumber ?? null,
      docs_expiry_alert: docsExpiryAlert(v.documents),
      created_at: v.createdAt.toISOString(),
      updated_at: v.updatedAt.toISOString(),
    };
  }

  private kmToPublic(r: KmRecord): KmRecordPublic {
    return {
      id: r.id,
      vehicle_id: r.vehicleId,
      km: r.km,
      recorded_by: r.recordedById,
      recorded_at: r.recordedAt.toISOString(),
      photo_url: r.photoUrl ?? null,
      ai_km: r.aiKm ?? null,
      check_status: r.checkStatus ?? null,
    };
  }

  private docToPublic(d: VehicleDocument): VehicleDocumentPublic {
    return {
      id: d.id,
      vehicle_id: d.vehicleId,
      type: d.type as VehicleDocType,
      number: d.number,
      issued_at: d.issuedAt?.toISOString() ?? null,
      expires_at: d.expiresAt.toISOString(),
      photo_url: d.photoUrl,
      holder_name: d.holderName,
      notes: d.notes,
      created_at: d.createdAt.toISOString(),
      updated_at: d.updatedAt.toISOString(),
    };
  }
}
