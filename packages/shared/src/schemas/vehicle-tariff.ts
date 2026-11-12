import { z } from 'zod';
import { VEHICLE_CATEGORIES } from '../enums';

// UZS som — non-negative whole numbers, capped at a sane upper bound.
const somField = z.number().int().min(0).max(1_000_000_000);

/**
 * Driver-pay tariff for one vehicle class (admin config). All amounts in UZS som.
 *  - daily_wage: flat per attended (timesheet) day
 *  - pickup: per pickup source, split in-city (shahar) vs outside-city (tashqari)
 *  - delivery: per order, split in-city vs outside-city
 *  - early_hour: per hour started before 09:00, paid by the minute
 */
export const vehicleTariffSchema = z.object({
  category: z.enum(VEHICLE_CATEGORIES),
  daily_wage_som: somField,
  pickup_city_som: somField,
  pickup_outside_som: somField,
  delivery_city_som: somField,
  delivery_outside_som: somField,
  early_hour_som: somField,
});
export type VehicleTariff = z.infer<typeof vehicleTariffSchema>;

/** Save-all payload — one entry per vehicle class. */
export const saveVehicleTariffsSchema = z.object({
  // A save that leaves out the early-hour price keeps the one already set.
  tariffs: z.array(vehicleTariffSchema.extend({ early_hour_som: somField.optional() })).min(1),
});
export type SaveVehicleTariffsInput = z.infer<typeof saveVehicleTariffsSchema>;

/** GET / PUT response: the full tariff table (one row per class). */
export const vehicleTariffsResponseSchema = z.object({
  tariffs: z.array(vehicleTariffSchema),
});
export type VehicleTariffsResponse = z.infer<typeof vehicleTariffsResponseSchema>;
