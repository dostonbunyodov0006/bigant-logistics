import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CargoType } from '@prisma/client';
import type { CargoTypePublic, CreateCargoTypeInput, UpdateCargoTypeInput } from '@bigant/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CargoTypesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<CargoTypePublic[]> {
    const rows = await this.prisma.cargoType.findMany({ orderBy: { name: 'asc' } });
    return rows.map((t) => this.toPublic(t));
  }

  async create(input: CreateCargoTypeInput): Promise<CargoTypePublic> {
    const name = input.name.trim();
    if (await this.prisma.cargoType.findUnique({ where: { name } })) {
      throw new BadRequestException('cargo_type_exists');
    }
    return this.toPublic(await this.prisma.cargoType.create({ data: { name } }));
  }

  async update(id: string, input: UpdateCargoTypeInput): Promise<CargoTypePublic> {
    await this.getOrThrow(id);
    const type = await this.prisma.cargoType.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name.trim() }),
        ...(input.active !== undefined && { active: input.active }),
      },
    });
    return this.toPublic(type);
  }

  async remove(id: string): Promise<{ deleted: true }> {
    await this.getOrThrow(id);
    const inUse = await this.prisma.order.count({ where: { cargoTypeId: id } });
    if (inUse > 0) {
      // Preserve order history — deactivate instead of deleting.
      throw new BadRequestException('cargo_type_in_use');
    }
    await this.prisma.cargoType.delete({ where: { id } });
    return { deleted: true };
  }

  private async getOrThrow(id: string): Promise<CargoType> {
    const type = await this.prisma.cargoType.findUnique({ where: { id } });
    if (!type) {
      throw new NotFoundException('Cargo type not found');
    }
    return type;
  }

  private toPublic(t: CargoType): CargoTypePublic {
    return { id: t.id, name: t.name, active: t.active };
  }
}
