import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Expense, ExpenseType } from '@prisma/client';
import type {
  CreateExpenseInput,
  CreateExpenseTypeInput,
  ExpenseFilterInput,
  ExpensePublic,
  ExpenseSummary,
  ExpenseTypePublic,
  UpdateExpenseInput,
  UpdateExpenseTypeInput,
  Page,
} from '@bigant/shared';
import { DEFAULT_PAGE_SIZE } from '@bigant/shared';
import { PrismaService } from '../prisma/prisma.service';

const MS_PER_DAY = 86_400_000;
const EXPENSE_INCLUDE = {
  type: { select: { name: true } },
  vehicle: { select: { plateNumber: true, model: true } },
  driver: { include: { user: { select: { name: true } } } },
  createdBy: { select: { name: true } },
};

/** Parse a YYYY-MM-DD string as a UTC date. */
function toDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

/** Format a stored date back to YYYY-MM-DD (UTC). */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type ExpenseWithRelations = Expense & {
  type?: { name: string } | null;
  vehicle?: { plateNumber: string; model: string } | null;
  driver?: { user: { name: string } } | null;
  createdBy?: { name: string } | null;
};

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Types (rasxod_types) ---

  async listTypes(): Promise<ExpenseTypePublic[]> {
    const types = await this.prisma.expenseType.findMany({ orderBy: { name: 'asc' } });
    return types.map((tp) => this.typeToPublic(tp));
  }

  async createType(input: CreateExpenseTypeInput): Promise<ExpenseTypePublic> {
    const name = input.name.trim();
    try {
      const type = await this.prisma.expenseType.create({ data: { name } });
      return this.typeToPublic(type);
    } catch (err) {
      // The name is unique in the database; letting it decide means two
      // admins adding the same type at once get the message, not a 500.
      if ((err as { code?: string }).code === 'P2002') {
        throw new BadRequestException('expense_type_exists');
      }
      throw err;
    }
  }

  async updateType(id: string, input: UpdateExpenseTypeInput): Promise<ExpenseTypePublic> {
    await this.getTypeOrThrow(id);
    const type = await this.prisma.expenseType.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name.trim() }),
        ...(input.active !== undefined && { active: input.active }),
      },
    });
    return this.typeToPublic(type);
  }

  async removeType(id: string): Promise<{ deleted: true }> {
    await this.getTypeOrThrow(id);
    const inUse = await this.prisma.expense.count({ where: { typeId: id } });
    if (inUse > 0) {
      // Preserve historical expenses — deactivate instead of deleting.
      throw new BadRequestException('expense_type_in_use');
    }
    await this.prisma.expenseType.delete({ where: { id } });
    return { deleted: true };
  }

  // --- Expenses (rasxod) ---

  async list(filters: ExpenseFilterInput): Promise<ExpensePublic[]> {
    const expenses = await this.prisma.expense.findMany({
      where: this.buildWhere(filters),
      include: EXPENSE_INCLUDE,
      orderBy: { spentAt: 'desc' },
      skip: filters.skip ?? 0,
      take: filters.take ?? DEFAULT_PAGE_SIZE,
    });
    return expenses.map((e) => this.toPublic(e));
  }

  /** A page plus the total match count — the previous flat `take: 500` dropped
   *  everything past the cap with no indication to the caller. */
  async listPage(filters: ExpenseFilterInput): Promise<Page<ExpensePublic>> {
    const where = this.buildWhere(filters);
    const [expenses, total] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        include: EXPENSE_INCLUDE,
        orderBy: { spentAt: 'desc' },
        skip: filters.skip ?? 0,
        take: filters.take ?? DEFAULT_PAGE_SIZE,
      }),
      this.prisma.expense.count({ where }),
    ]);
    return { items: expenses.map((e) => this.toPublic(e)), total };
  }

  async create(input: CreateExpenseInput, createdById: string): Promise<ExpensePublic> {
    await this.assertType(input.type_id);
    await this.assertVehicle(input.vehicle_id);
    await this.assertDriver(input.driver_id);
    const expense = await this.prisma.expense.create({
      data: {
        typeId: input.type_id,
        amount: input.amount,
        spentAt: toDate(input.spent_at),
        note: input.note?.trim() || null,
        vehicleId: input.vehicle_id ?? null,
        driverId: input.driver_id ?? null,
        createdById,
      },
      include: EXPENSE_INCLUDE,
    });
    return this.toPublic(expense);
  }

  async update(id: string, input: UpdateExpenseInput): Promise<ExpensePublic> {
    assertTypedByHand(await this.getOrThrow(id));
    if (input.type_id) await this.assertType(input.type_id);
    if (input.vehicle_id) await this.assertVehicle(input.vehicle_id);
    if (input.driver_id) await this.assertDriver(input.driver_id);
    const expense = await this.prisma.expense.update({
      where: { id },
      data: {
        ...(input.type_id !== undefined && { typeId: input.type_id }),
        ...(input.amount !== undefined && { amount: input.amount }),
        ...(input.spent_at !== undefined && { spentAt: toDate(input.spent_at) }),
        ...(input.note !== undefined && { note: input.note?.trim() || null }),
        ...(input.vehicle_id !== undefined && { vehicleId: input.vehicle_id ?? null }),
        ...(input.driver_id !== undefined && { driverId: input.driver_id ?? null }),
      },
      include: EXPENSE_INCLUDE,
    });
    return this.toPublic(expense);
  }

  async remove(id: string): Promise<{ deleted: true }> {
    assertTypedByHand(await this.getOrThrow(id));
    await this.prisma.expense.delete({ where: { id } });
    return { deleted: true };
  }

  // --- Report ---

  async summary(filters: ExpenseFilterInput): Promise<ExpenseSummary> {
    const where = this.buildWhere(filters);
    const groups = await this.prisma.expense.groupBy({
      by: ['typeId'],
      where,
      _sum: { amount: true },
      _count: { _all: true },
    });
    const names = await this.resolveTypeNames(groups.map((g) => g.typeId));

    const by_type = groups
      .map((g) => ({
        type_id: g.typeId,
        type_name: names.get(g.typeId) ?? null,
        total: g._sum.amount ?? 0,
        count: g._count._all,
      }))
      .sort((a, b) => b.total - a.total);

    const summary = by_type.reduce(
      (acc, r) => {
        acc.total += r.total;
        acc.count += r.count;
        return acc;
      },
      { total: 0, count: 0 },
    );

    return { summary, by_type };
  }

  // --- Helpers ---

  private buildWhere(filters: ExpenseFilterInput) {
    const start = filters.from ? toDate(filters.from) : undefined;
    // `to` is inclusive of that whole calendar day.
    const end = filters.to ? new Date(toDate(filters.to).getTime() + MS_PER_DAY) : undefined;
    return {
      ...(filters.type_id ? { typeId: filters.type_id } : {}),
      ...(filters.vehicle_id ? { vehicleId: filters.vehicle_id } : {}),
      ...(filters.driver_id ? { driverId: filters.driver_id } : {}),
      ...(start || end ? { spentAt: { ...(start && { gte: start }), ...(end && { lt: end }) } } : {}),
    };
  }

  private async resolveTypeNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const types = await this.prisma.expenseType.findMany({ where: { id: { in: ids } } });
    return new Map(types.map((tp) => [tp.id, tp.name]));
  }

  private async assertType(typeId: string): Promise<void> {
    const type = await this.prisma.expenseType.findUnique({ where: { id: typeId } });
    if (!type) throw new BadRequestException('expense_type_not_found');
  }

  private async assertVehicle(vehicleId?: string | null): Promise<void> {
    if (!vehicleId) return;
    const v = await this.prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!v) throw new BadRequestException('vehicle_not_found');
  }

  private async assertDriver(driverId?: string | null): Promise<void> {
    if (!driverId) return;
    const d = await this.prisma.driver.findUnique({ where: { id: driverId } });
    if (!d) throw new BadRequestException('driver_not_found');
  }

  private async getTypeOrThrow(id: string): Promise<ExpenseType> {
    const type = await this.prisma.expenseType.findUnique({ where: { id } });
    if (!type) throw new NotFoundException('Expense type not found');
    return type;
  }

  private async getOrThrow(id: string): Promise<Expense> {
    const expense = await this.prisma.expense.findUnique({ where: { id } });
    if (!expense) throw new NotFoundException('Expense not found');
    return expense;
  }

  private typeToPublic(tp: ExpenseType): ExpenseTypePublic {
    return {
      id: tp.id,
      name: tp.name,
      active: tp.active,
      created_at: tp.createdAt.toISOString(),
    };
  }

  private toPublic(e: ExpenseWithRelations): ExpensePublic {
    const vehicle = e.vehicle;
    return {
      id: e.id,
      type_id: e.typeId,
      type_name: e.type?.name ?? null,
      amount: e.amount,
      spent_at: ymd(e.spentAt),
      note: e.note,
      vehicle_id: e.vehicleId,
      vehicle_label: vehicle ? `${vehicle.plateNumber} · ${vehicle.model}` : null,
      driver_id: e.driverId,
      driver_name: e.driver?.user?.name ?? null,
      created_by_id: e.createdById,
      created_by_name: e.createdBy?.name ?? null,
      created_at: e.createdAt.toISOString(),
      source: e.fuelLogId ? 'fuel' : e.serviceVisitId ? 'service' : null,
    };
  }
}

/** A fuel or service row follows its fill or visit; it is corrected there. */
function assertTypedByHand(e: Expense): void {
  if (e.fuelLogId || e.serviceVisitId) throw new ConflictException('expense_auto');
}
