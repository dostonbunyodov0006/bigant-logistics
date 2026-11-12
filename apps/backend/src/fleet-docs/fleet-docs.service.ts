import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { DocumentRow, FleetDocKind, TechPassportRow, VehicleDocType } from '@bigant/shared';
import { PrismaService } from '../prisma/prisma.service';
import { UploadService } from '../upload/upload.service';
import { TelegramSender } from '../telegram/telegram.sender';

/**
 * The papers of the fleet: both sides of a lorry's tech passport and both
 * sides of its driver's licence.
 *
 * A seller is asked for these by a client or a warehouse, over Telegram, and
 * used to photograph the office copy on his own phone. The office uploads
 * them once here; the seller has the bot drop them into his own chat and
 * forwards from there. They go as documents, not photos — Telegram
 * recompresses a photo, and a passport has to stay readable.
 */
@Injectable()
export class FleetDocsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly upload: UploadService,
    private readonly telegram: TelegramSender,
  ) {}

  /** Every lorry with its driver and papers, in plate order — the office's
   *  Hujjatlar page and the seller's shelf read the same rows. */
  async list(): Promise<TechPassportRow[]> {
    const vehicles = await this.prisma.vehicle.findMany({
      where: { status: { not: 'inactive' } },
      include: { driver: { include: { user: { select: { name: true } } } } },
      orderBy: { plateNumber: 'asc' },
    });
    const rows: TechPassportRow[] = vehicles.map((v) => ({
      vehicle_id: v.id,
      driver_id: v.driver?.id ?? null,
      plate_number: v.plateNumber,
      model: v.model,
      driver_name: v.driver?.user?.name ?? null,
      tech_passport: v.techPassport,
      owner: v.owner,
      capacity_kg: v.capacityKg,
      length_cm: v.lengthCm,
      width_cm: v.widthCm,
      height_cm: v.heightCm,
      license_category: v.driver?.licenseCategory ?? null,
      license_years: v.driver?.licenseIssuedAt ? yearsSince(v.driver.licenseIssuedAt) : null,
      license_expires_at: v.driver?.licenseExpiresAt ? v.driver.licenseExpiresAt.toISOString().slice(0, 10) : null,
      tech_passport_front_url: v.techPassportFrontUrl,
      tech_passport_back_url: v.techPassportBackUrl,
      license_front_url: v.driver?.licenseFrontUrl ?? null,
      license_back_url: v.driver?.licenseBackUrl ?? null,
    }));
    // A driver without a lorry (owner, 03.11.2026: Qodirov Abduvohid's licence
    // "was not there" — he had no lorry, so no row). His licence is a paper
    // the office keeps all the same; he comes after the lorries, with no plate.
    const unassigned = await this.prisma.driver.findMany({
      where: { vehicleId: null, user: { status: 'active' } },
      include: { user: { select: { name: true } } },
      orderBy: { user: { name: 'asc' } },
    });
    return [
      ...rows,
      ...unassigned.map((d) => ({
        vehicle_id: null,
        driver_id: d.id,
        plate_number: null,
        model: null,
        driver_name: d.user?.name ?? null,
        tech_passport: null,
        owner: null,
        capacity_kg: null,
        length_cm: null,
        width_cm: null,
        height_cm: null,
        license_category: d.licenseCategory ?? null,
        license_years: d.licenseIssuedAt ? yearsSince(d.licenseIssuedAt) : null,
        license_expires_at: d.licenseExpiresAt ? d.licenseExpiresAt.toISOString().slice(0, 10) : null,
        tech_passport_front_url: null,
        tech_passport_back_url: null,
        license_front_url: d.licenseFrontUrl ?? null,
        license_back_url: d.licenseBackUrl ?? null,
      })),
    ];
  }

  /** Every active lorry with its latest paper of one kind, or none. */
  async documentsOf(type: VehicleDocType): Promise<DocumentRow[]> {
    const vehicles = await this.prisma.vehicle.findMany({
      where: { status: { not: 'inactive' } },
      include: {
        driver: { include: { user: { select: { name: true } } } },
        documents: { where: { type }, orderBy: { expiresAt: 'desc' }, take: 1 },
      },
      orderBy: { plateNumber: 'asc' },
    });
    return vehicles.map((v) => {
      const d = v.documents[0];
      return {
        vehicle_id: v.id,
        plate_number: v.plateNumber,
        model: v.model,
        driver_name: v.driver?.user?.name ?? null,
        document: d
          ? {
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
            }
          : null,
      };
    });
  }

  async setDocumentPhoto(docId: string, base64: string): Promise<{ url: string }> {
    if (!(await this.prisma.vehicleDocument.findUnique({ where: { id: docId }, select: { id: true } }))) {
      throw new NotFoundException('Vehicle document not found');
    }
    const url = await this.upload.uploadBase64(base64, 'fleet-docs');
    await this.prisma.vehicleDocument.update({ where: { id: docId }, data: { photoUrl: url } });
    return { url };
  }

  async clearDocumentPhoto(docId: string): Promise<{ deleted: true }> {
    await this.prisma.vehicleDocument.update({ where: { id: docId }, data: { photoUrl: null } });
    return { deleted: true };
  }

  async setVehiclePhoto(vehicleId: string, kind: FleetDocKind, base64: string): Promise<{ url: string }> {
    const column = vehicleColumn(kind);
    if (!(await this.prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { id: true } }))) {
      throw new NotFoundException('Vehicle not found');
    }
    const url = await this.upload.uploadBase64(base64, 'fleet-docs');
    await this.prisma.vehicle.update({ where: { id: vehicleId }, data: { [column]: url } });
    return { url };
  }

  async clearVehiclePhoto(vehicleId: string, kind: FleetDocKind): Promise<{ deleted: true }> {
    const column = vehicleColumn(kind);
    await this.prisma.vehicle.update({ where: { id: vehicleId }, data: { [column]: null } });
    return { deleted: true };
  }

  async setDriverPhoto(driverId: string, kind: FleetDocKind, base64: string): Promise<{ url: string }> {
    const column = driverColumn(kind);
    if (!(await this.prisma.driver.findUnique({ where: { id: driverId }, select: { id: true } }))) {
      throw new NotFoundException('Driver not found');
    }
    const url = await this.upload.uploadBase64(base64, 'fleet-docs');
    await this.prisma.driver.update({ where: { id: driverId }, data: { [column]: url } });
    return { url };
  }

  async clearDriverPhoto(driverId: string, kind: FleetDocKind): Promise<{ deleted: true }> {
    const column = driverColumn(kind);
    await this.prisma.driver.update({ where: { id: driverId }, data: { [column]: null } });
    return { deleted: true };
  }

  /**
   * Drops a driver's papers into the asking seller's own Telegram chat.
   *
   * The bot can only write to someone who has opened it, and only knows who
   * the seller is through the Telegram id the office put on his account — so
   * both absences are named, not swallowed.
   */
  async sendToSeller(driverId: string, sellerUserId: string): Promise<{ sent: number }> {
    const [seller, driver] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: sellerUserId }, select: { telegramId: true } }),
      this.prisma.driver.findUnique({
        where: { id: driverId },
        include: { user: { select: { name: true } }, vehicle: true },
      }),
    ]);
    if (!driver) throw new NotFoundException('Driver not found');
    if (!seller?.telegramId || !/^\d+$/.test(seller.telegramId)) {
      throw new BadRequestException('telegram_not_linked');
    }
    const files = [
      driver.vehicle?.techPassportFrontUrl,
      driver.vehicle?.techPassportBackUrl,
      driver.licenseFrontUrl,
      driver.licenseBackUrl,
    ].filter((u): u is string => !!u);
    if (files.length === 0) throw new BadRequestException('no_documents');

    const lines = [
      driver.user?.name ?? '',
      driver.vehicle ? `${driver.vehicle.plateNumber} · ${driver.vehicle.model}` : '',
      driver.vehicle?.techPassport ? `Texpasport: ${driver.vehicle.techPassport}` : '',
      driver.licenseCategory ? `Prava: ${driver.licenseCategory}` : '',
    ].filter(Boolean);
    const result = await this.telegram.send(
      { text: lines.join('\n'), photoUrl: files[0], morePhotoUrls: files.slice(1), asDocuments: true },
      seller.telegramId,
    );
    if (!result.delivered) throw new BadRequestException('telegram_send_failed');
    return { sent: files.length };
  }
}

/** Whole years since a date, the way the office counts staj. */
function yearsSince(d: Date): number {
  const now = new Date();
  let years = now.getUTCFullYear() - d.getUTCFullYear();
  if (now.getUTCMonth() < d.getUTCMonth() || (now.getUTCMonth() === d.getUTCMonth() && now.getUTCDate() < d.getUTCDate())) years -= 1;
  return Math.max(0, years);
}

function vehicleColumn(kind: FleetDocKind): 'techPassportFrontUrl' | 'techPassportBackUrl' {
  if (kind === 'tech_front') return 'techPassportFrontUrl';
  if (kind === 'tech_back') return 'techPassportBackUrl';
  throw new BadRequestException('not_a_vehicle_document');
}

function driverColumn(kind: FleetDocKind): 'licenseFrontUrl' | 'licenseBackUrl' {
  if (kind === 'license_front') return 'licenseFrontUrl';
  if (kind === 'license_back') return 'licenseBackUrl';
  throw new BadRequestException('not_a_driver_document');
}
