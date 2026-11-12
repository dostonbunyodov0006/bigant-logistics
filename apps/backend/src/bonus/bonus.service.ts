import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { BonusLog, BonusRule } from '@prisma/client';
import type {
  BonusAppliesTo,
  BonusLogFilterInput,
  BonusLogPublic,
  BonusRulePublic,
  CreateBonusRuleInput,
  UpdateBonusRuleInput,
} from '@bigant/shared';
import { PrismaService } from '../prisma/prisma.service';
import { tashkentDayStartUtc } from '../common/tashkent-time';

const MS_PER_DAY = 86_400_000;
const RULE_INCLUDE = { region: true, geoDistrict: true };

/** A YYYY-MM-DD calendar day as its start in Tashkent, as a UTC instant. */
function toDate(s: string): Date {
  return tashkentDayStartUtc(s);
}

/** Minimal order shape needed to accrue bonuses on delivery. */
export interface AccrualOrder {
  id: string;
  regionCode: string | null;
  geoDistrictCode: string | null;
  priority: string;
  assignedDriverId: string | null;
}

@Injectable()
export class BonusService {
  private readonly logger = new Logger(BonusService.name);

  constructor(private readonly prisma: PrismaService) {}

  // --- Rules ---

  async createRule(input: CreateBonusRuleInput): Promise<BonusRulePublic> {
    await this.assertGeo(input.region_code, input.district_code);
    const rule = await this.prisma.bonusRule.create({
      data: {
        name: input.name.trim(),
        amount: input.amount,
        appliesTo: input.applies_to,
        regionCode: input.region_code ?? null,
        geoDistrictCode: input.district_code ?? null,
      },
      include: RULE_INCLUDE,
    });
    return this.ruleToPublic(rule);
  }

  async listRules(): Promise<BonusRulePublic[]> {
    const rules = await this.prisma.bonusRule.findMany({
      include: RULE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rules.map((r) => this.ruleToPublic(r));
  }

  async updateRule(id: string, input: UpdateBonusRuleInput): Promise<BonusRulePublic> {
    await this.getRuleOrThrow(id);
    if (input.region_code || input.district_code) {
      await this.assertGeo(input.region_code, input.district_code);
    }
    const rule = await this.prisma.bonusRule.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name.trim() }),
        ...(input.amount !== undefined && { amount: input.amount }),
        ...(input.applies_to !== undefined && { appliesTo: input.applies_to }),
        ...(input.region_code !== undefined && { regionCode: input.region_code ?? null }),
        ...(input.district_code !== undefined && { geoDistrictCode: input.district_code ?? null }),
        ...(input.active !== undefined && { active: input.active }),
      },
      include: RULE_INCLUDE,
    });
    return this.ruleToPublic(rule);
  }

  async removeRule(id: string): Promise<{ deleted: true }> {
    await this.getRuleOrThrow(id);
    await this.prisma.bonusRule.delete({ where: { id } });
    return { deleted: true };
  }

  // --- Accrual ---

  /**
   * Accrue bonuses for a just-delivered order: every active rule whose geo scope
   * (region, and district if set) and priority scope match earns the assigned
   * driver `amount`. A rule with a null region/district applies to all of them.
   * Idempotent via the unique (orderId, ruleId) constraint.
   */
  async accrueForDelivery(order: AccrualOrder): Promise<void> {
    if (!order.assignedDriverId) {
      return;
    }
    const rules = await this.prisma.bonusRule.findMany({
      where: {
        active: true,
        AND: [
          { OR: [{ regionCode: null }, ...(order.regionCode ? [{ regionCode: order.regionCode }] : [])] },
          {
            OR: [
              { geoDistrictCode: null },
              ...(order.geoDistrictCode ? [{ geoDistrictCode: order.geoDistrictCode }] : []),
            ],
          },
          { OR: [{ appliesTo: 'all' as const }, { appliesTo: order.priority as BonusAppliesTo }] },
        ],
      },
    });
    if (rules.length === 0) {
      return;
    }
    await this.prisma.bonusLog.createMany({
      data: rules.map((r) => ({
        driverId: order.assignedDriverId!,
        orderId: order.id,
        ruleId: r.id,
        ruleName: r.name,
        amount: r.amount,
      })),
      skipDuplicates: true,
    });
    this.logger.log(`Accrued ${rules.length} bonus rule(s) for order ${order.id}`);
  }

  // --- Logs (report data) ---

  async listLogs(filters: BonusLogFilterInput): Promise<BonusLogPublic[]> {
    const start = filters.from ? toDate(filters.from) : undefined;
    const end = filters.to ? new Date(toDate(filters.to).getTime() + MS_PER_DAY) : undefined;
    const logs = await this.prisma.bonusLog.findMany({
      where: {
        ...(filters.driver_id ? { driverId: filters.driver_id } : {}),
        ...(start || end
          ? { accruedAt: { ...(start && { gte: start }), ...(end && { lt: end }) } }
          : {}),
      },
      include: { driver: { include: { user: true } }, order: { select: { orderNumber: true, clientName: true } } },
      orderBy: { accruedAt: 'desc' },
      take: 500,
    });
    return logs.map((l) => this.logToPublic(l));
  }

  // --- Helpers ---

  private async assertGeo(regionCode?: string | null, districtCode?: string | null): Promise<void> {
    if (regionCode) {
      const region = await this.prisma.region.findUnique({ where: { code: regionCode } });
      if (!region) {
        throw new BadRequestException('region_not_found');
      }
    }
    if (districtCode) {
      const district = await this.prisma.geoDistrict.findUnique({ where: { code: districtCode } });
      if (!district) {
        throw new BadRequestException('district_not_found');
      }
    }
  }

  private async getRuleOrThrow(id: string): Promise<BonusRule> {
    const rule = await this.prisma.bonusRule.findUnique({ where: { id } });
    if (!rule) {
      throw new NotFoundException('Bonus rule not found');
    }
    return rule;
  }

  private ruleToPublic(
    r: BonusRule & { region?: { name: string } | null; geoDistrict?: { name: string } | null },
  ): BonusRulePublic {
    return {
      id: r.id,
      name: r.name,
      active: r.active,
      amount: r.amount,
      applies_to: r.appliesTo as BonusAppliesTo,
      region_code: r.regionCode,
      region_name: r.region?.name ?? null,
      district_code: r.geoDistrictCode,
      district_name: r.geoDistrict?.name ?? null,
      created_at: r.createdAt.toISOString(),
      updated_at: r.updatedAt.toISOString(),
    };
  }

  private logToPublic(
    l: BonusLog & { driver?: { user: { name: string } } | null; order?: { orderNumber: number; clientName: string } | null },
  ): BonusLogPublic {
    return {
      id: l.id,
      driver_id: l.driverId,
      driver_name: l.driver?.user?.name ?? null,
      order_id: l.orderId,
      order_number: l.order?.orderNumber ?? null,
      client_name: l.order?.clientName ?? null,
      rule_id: l.ruleId,
      rule_name: l.ruleName,
      amount: l.amount,
      accrued_at: l.accruedAt.toISOString(),
    };
  }
}
