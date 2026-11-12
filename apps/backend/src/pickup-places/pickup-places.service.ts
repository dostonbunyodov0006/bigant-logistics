import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PickupPlace } from '@prisma/client';
import type {
  CreatePickupPlaceInput,
  PickupPlacePublic,
  PickupPlaceType,
  Role,
  UpdatePickupPlaceInput,
} from '@bigant/shared';
import { PrismaService } from '../prisma/prisma.service';

/** Resolve the region/district names alongside the place, so the UI can show
 *  "Toshkent shahri · Yunusobod tumani" without a second round-trip. */
const PLACE_INCLUDE = {
  region: { select: { name: true } },
  geoDistrict: { select: { name: true } },
  // One supplier may load from several yards; the picker groups them by name.
  supplier: { select: { name: true } },
} as const;

type PlaceRow = PickupPlace & {
  region?: { name: string } | null;
  geoDistrict?: { name: string } | null;
  supplier?: { name: string } | null;
};

@Injectable()
export class PickupPlacesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreatePickupPlaceInput, createdById: string, role: Role): Promise<PickupPlacePublic> {
    // Our shop and warehouse are added by the admin or the dispatcher only (owner, 06.11.2026);
    // a seller adds a supplier's yard.
    if (role !== 'admin' && role !== 'manager' && input.type !== 'custom') {
      throw new ForbiddenException('pickup_place_type_staff_only');
    }
    const place = await this.prisma.pickupPlace.create({
      data: {
        name: input.name,
        address: input.address,
        phoneNumber: input.phone_number ?? null,
        type: input.type,
        isTemporary: input.is_temporary ?? false,
        regionCode: input.region_code,
        geoDistrictCode: input.district_code ?? null,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        // Null for our own shop and warehouse, which belong to no supplier.
        supplierId: input.supplier_id ?? null,
        oneOff: input.one_off ?? false,
        createdById,
      },
      include: PLACE_INCLUDE,
    });
    return this.toPublic(place);
  }

  async findAll(): Promise<PickupPlacePublic[]> {
    const places = await this.prisma.pickupPlace.findMany({
      // A yard visited once is not part of the directory.
      where: { oneOff: false },
      orderBy: { createdAt: 'desc' },
      include: PLACE_INCLUDE,
    });
    return places.map((p) => this.toPublic(p));
  }

  async findOne(id: string): Promise<PickupPlacePublic> {
    return this.toPublic(await this.getOrThrow(id));
  }

  async update(id: string, input: UpdatePickupPlaceInput): Promise<PickupPlacePublic> {
    await this.getOrThrow(id);
    const place = await this.prisma.pickupPlace.update({
      where: { id },
      data: {
        name: input.name,
        address: input.address,
        ...(input.phone_number !== undefined && { phoneNumber: input.phone_number ?? null }),
        type: input.type,
        isTemporary: input.is_temporary,
        ...(input.region_code !== undefined && { regionCode: input.region_code }),
        // A region change clears a now-stale district unless a new one is given.
        ...((input.district_code !== undefined || input.region_code !== undefined) && {
          geoDistrictCode: input.district_code ?? null,
        }),
        // Pair-validated by the schema; a patch either moves the pin or leaves it.
        ...(input.lat !== undefined && { lat: input.lat, lng: input.lng }),
        ...(input.supplier_id !== undefined && { supplierId: input.supplier_id ?? null }),
      },
      include: PLACE_INCLUDE,
    });
    return this.toPublic(place);
  }

  async remove(id: string): Promise<{ deleted: true }> {
    await this.getOrThrow(id);
    try {
      await this.prisma.pickupPlace.delete({ where: { id } });
    } catch (err) {
      // Orders still name the place; the database refuses, and that is a rule
      // the office should read, not a 500.
      const code = (err as { code?: string }).code;
      if (code === 'P2003' || code === 'P2014') throw new ConflictException('pickup_place_in_use');
      throw err;
    }
    return { deleted: true };
  }

  private async getOrThrow(id: string): Promise<PlaceRow> {
    const place = await this.prisma.pickupPlace.findUnique({
      where: { id },
      include: PLACE_INCLUDE,
    });
    if (!place) {
      throw new NotFoundException('Pickup place not found');
    }
    return place;
  }

  private toPublic(p: PlaceRow): PickupPlacePublic {
    return {
      id: p.id,
      name: p.name,
      address: p.address,
      phone_number: p.phoneNumber ?? null,
      type: p.type as PickupPlaceType,
      is_temporary: p.isTemporary,
      supplier_id: p.supplierId,
      supplier_name: p.supplier?.name ?? null,
      region_code: p.regionCode,
      region_name: p.region?.name ?? null,
      district_code: p.geoDistrictCode,
      district_name: p.geoDistrict?.name ?? null,
      lat: p.lat,
      lng: p.lng,
      created_by: p.createdById,
      created_at: p.createdAt.toISOString(),
      updated_at: p.updatedAt.toISOString(),
    };
  }
}
