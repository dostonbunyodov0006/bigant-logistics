import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateSupplierInput, SupplierPublic, UpdateSupplierInput } from '@bigant/shared';
import { PrismaService } from '../prisma/prisma.service';

const SUPPLIER_INCLUDE = { _count: { select: { pickupPlaces: true } } } as const;

/**
 * The suppliers the drivers collect from.
 *
 * One supplier often loads from several yards. Naming each yard separately in
 * one flat list made the seller read three near-identical names and guess;
 * with the supplier above them, the name is picked once and the yard second.
 */
@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(includeInactive = false): Promise<SupplierPublic[]> {
    const rows = await this.prisma.supplier.findMany({
      where: includeInactive ? {} : { active: true },
      include: SUPPLIER_INCLUDE,
      orderBy: { name: 'asc' },
    });
    return rows.map(toPublic);
  }

  async create(input: CreateSupplierInput, createdById: string): Promise<SupplierPublic> {
    try {
      const row = await this.prisma.supplier.create({
        data: {
          name: input.name,
          phoneNumber: input.phone_number?.trim() || null,
          createdById,
        },
        include: SUPPLIER_INCLUDE,
      });
      return toPublic(row);
    } catch (err) {
      // The name is unique in the database; letting it decide means two people
      // adding the same supplier at once get the message, not a 500.
      if ((err as { code?: string }).code === 'P2002') {
        throw new BadRequestException('supplier_exists');
      }
      throw err;
    }
  }

  async update(id: string, input: UpdateSupplierInput): Promise<SupplierPublic> {
    const current = await this.prisma.supplier.findUnique({
      where: { id },
      include: SUPPLIER_INCLUDE,
    });
    if (!current) throw new NotFoundException('supplier_not_found');
    // A supplier still being collected from cannot be switched off: its yards
    // would stay in the pickers with nothing above them.
    if (input.active === false && current._count.pickupPlaces > 0) {
      throw new BadRequestException('supplier_in_use');
    }
    try {
      const row = await this.prisma.supplier.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.phone_number !== undefined
            ? { phoneNumber: input.phone_number?.trim() || null }
            : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        },
        include: SUPPLIER_INCLUDE,
      });
      return toPublic(row);
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new BadRequestException('supplier_exists');
      }
      throw err;
    }
  }
}

function toPublic(s: {
  id: string;
  name: string;
  phoneNumber: string | null;
  active: boolean;
  _count: { pickupPlaces: number };
}): SupplierPublic {
  return {
    id: s.id,
    name: s.name,
    phone_number: s.phoneNumber,
    active: s.active,
    places_count: s._count.pickupPlaces,
  };
}
