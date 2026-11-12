import { Injectable } from '@nestjs/common';
import type { VehicleTariff as VehicleTariffRow } from '@prisma/client';
import {
  VEHICLE_CATEGORIES,
  type SaveVehicleTariffsInput,
  type VehicleTariff,
  type VehicleTariffsResponse,
} from '@bigant/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class VehicleTariffsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The full tariff table — one entry per vehicle class, in canonical order.
   * Classes without a saved row yet default to all-zero (never persisted until saved).
   */
  async getAll(): Promise<VehicleTariffsResponse> {
    const rows = await this.prisma.vehicleTariff.findMany();
    const byCategory = new Map(rows.map((r) => [r.category, r]));
    const tariffs = VEHICLE_CATEGORIES.map((category) => {
      const row = byCategory.get(category);
      return row ? this.toPublic(row) : this.blank(category);
    });
    return { tariffs };
  }

  /** Upsert every submitted class row. Returns the full refreshed table. */
  async saveAll(input: SaveVehicleTariffsInput): Promise<VehicleTariffsResponse> {
    await this.prisma.$transaction(
      input.tariffs.map((t) =>
        this.prisma.vehicleTariff.upsert({
          where: { category: t.category },
          create: {
            category: t.category,
            dailyWageSom: t.daily_wage_som,
            pickupCitySom: t.pickup_city_som,
            pickupOutsideSom: t.pickup_outside_som,
            deliveryCitySom: t.delivery_city_som,
            deliveryOutsideSom: t.delivery_outside_som,
            earlyHourSom: t.early_hour_som ?? 0,
          },
          update: {
            dailyWageSom: t.daily_wage_som,
            pickupCitySom: t.pickup_city_som,
            pickupOutsideSom: t.pickup_outside_som,
            deliveryCitySom: t.delivery_city_som,
            deliveryOutsideSom: t.delivery_outside_som,
            // Left out by a settings screen that does not show it yet: keep it.
            ...(t.early_hour_som !== undefined ? { earlyHourSom: t.early_hour_som } : {}),
          },
        }),
      ),
    );
    return this.getAll();
  }

  private blank(category: VehicleTariff['category']): VehicleTariff {
    return {
      category,
      daily_wage_som: 0,
      pickup_city_som: 0,
      pickup_outside_som: 0,
      delivery_city_som: 0,
      delivery_outside_som: 0,
      early_hour_som: 0,
    };
  }

  private toPublic(row: VehicleTariffRow): VehicleTariff {
    return {
      category: row.category,
      daily_wage_som: row.dailyWageSom,
      pickup_city_som: row.pickupCitySom,
      pickup_outside_som: row.pickupOutsideSom,
      delivery_city_som: row.deliveryCitySom,
      delivery_outside_som: row.deliveryOutsideSom,
      early_hour_som: row.earlyHourSom,
    };
  }
}
