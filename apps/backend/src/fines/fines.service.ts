import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Fine } from '@prisma/client';
import type {
  CreateFineInput,
  FineFilterInput,
  FinePage,
  FinePublic,
  UpdateFineInput,
} from '@bigant/shared';
import { DEFAULT_PAGE_SIZE } from '@bigant/shared';
import { PrismaService } from '../prisma/prisma.service';
import { tashkentDayStartUtc } from '../common/tashkent-time';
import { isPayDayLocked } from '../payroll/period-lock';

const MS_PER_DAY = 86_400_000;
const FINE_INCLUDE = {
  driver: { include: { user: true } },
  order: { select: { orderNumber: true, clientName: true } },
  issuedBy: { select: { name: true } },
};

/** A YYYY-MM-DD calendar day as its start in Tashkent, as a UTC instant. */
function toDate(s: string): Date {
  return tashkentDayStartUtc(s);
}

type FineWithRelations = Fine & {
  driver?: { user: { name: string } } | null;
  order?: { orderNumber: number; clientName: string } | null;
  issuedBy?: { name: string } | null;
};

@Injectable()
export class FinesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateFineInput, issuedById: string): Promise<FinePublic> {
    await this.assertDriver(input.driver_id);
    await this.assertOrder(input.order_id);
    const fine = await this.prisma.fine.create({
      data: {
        driverId: input.driver_id,
        amount: input.amount,
        reason: input.reason.trim(),
        orderId: input.order_id ?? null,
        issuedById,
      },
      include: FINE_INCLUDE,
    });
    return this.toPublic(fine);
  }

  private buildWhere(filters: FineFilterInput) {
    const start = filters.from ? toDate(filters.from) : undefined;
    const end = filters.to ? new Date(toDate(filters.to).getTime() + MS_PER_DAY) : undefined;
    return {
      ...(filters.driver_id ? { driverId: filters.driver_id } : {}),
      ...(start || end
        ? { createdAt: { ...(start && { gte: start }), ...(end && { lt: end }) } }
        : {}),
    };
  }

  async list(filters: FineFilterInput): Promise<FinePublic[]> {
    const fines = await this.prisma.fine.findMany({
      where: this.buildWhere(filters),
      include: FINE_INCLUDE,
      orderBy: { createdAt: 'desc' },
      skip: filters.skip ?? 0,
      take: filters.take ?? DEFAULT_PAGE_SIZE,
    });
    return fines.map((f) => this.toPublic(f));
  }

  /** A page plus the total match count, so the UI can tell that more exists —
   *  the previous flat `take: 500` silently dropped everything past the cap. */
  async listPage(filters: FineFilterInput): Promise<FinePage> {
    const where = this.buildWhere(filters);
    const [fines, total, sum] = await Promise.all([
      this.prisma.fine.findMany({
        where,
        include: FINE_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: filters.skip ?? 0,
        take: filters.take ?? DEFAULT_PAGE_SIZE,
      }),
      this.prisma.fine.count({ where }),
      // Summed server-side over the whole match: the page total would be a
      // misleading figure to print next to the word "Total".
      this.prisma.fine.aggregate({ where, _sum: { amount: true } }),
    ]);
    return {
      items: fines.map((f) => this.toPublic(f)),
      total,
      total_amount: sum._sum.amount ?? 0,
    };
  }

  async update(id: string, input: UpdateFineInput): Promise<FinePublic> {
    this.assertOpen(await this.getOrThrow(id));
    if (input.order_id) {
      await this.assertOrder(input.order_id);
    }
    const fine = await this.prisma.fine.update({
      where: { id },
      data: {
        ...(input.amount !== undefined && { amount: input.amount }),
        ...(input.reason !== undefined && { reason: input.reason.trim() }),
        ...(input.order_id !== undefined && { orderId: input.order_id ?? null }),
      },
      include: FINE_INCLUDE,
    });
    return this.toPublic(fine);
  }

  async remove(id: string): Promise<{ deleted: true }> {
    this.assertOpen(await this.getOrThrow(id));
    await this.prisma.fine.delete({ where: { id } });
    return { deleted: true };
  }

  // --- Helpers ---

  /** A fine issued in a paid, locked period stays as paid (owner, 07.11.2026). */
  private assertOpen(fine: { createdAt: Date }): void {
    if (isPayDayLocked(fine.createdAt)) throw new BadRequestException('period_locked');
  }

  private async assertDriver(driverId: string): Promise<void> {
    const driver = await this.prisma.driver.findUnique({ where: { id: driverId } });
    if (!driver) {
      throw new BadRequestException('driver_not_found');
    }
  }

  private async assertOrder(orderId?: string | null): Promise<void> {
    if (!orderId) {
      return;
    }
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new BadRequestException('order_not_found');
    }
  }

  private async getOrThrow(id: string): Promise<Fine> {
    const fine = await this.prisma.fine.findUnique({ where: { id } });
    if (!fine) {
      throw new NotFoundException('Fine not found');
    }
    return fine;
  }

  private toPublic(f: FineWithRelations): FinePublic {
    return {
      id: f.id,
      driver_id: f.driverId,
      driver_name: f.driver?.user?.name ?? null,
      order_id: f.orderId,
      order_number: f.order?.orderNumber ?? null,
      client_name: f.order?.clientName ?? null,
      reason: f.reason,
      amount: f.amount,
      issued_by_id: f.issuedById,
      issued_by_name: f.issuedBy?.name ?? null,
      created_at: f.createdAt.toISOString(),
      updated_at: f.updatedAt.toISOString(),
    };
  }
}
