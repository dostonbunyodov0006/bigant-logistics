import { photoUrlSchema } from './photo-url';
import { z } from 'zod';
import { pageSchema, paginationSchema } from './pagination';
import { INCIDENT_TYPES, VEHICLE_CATEGORIES, VEHICLE_DOC_TYPES, VEHICLE_STATUSES, VEHICLE_TYPES } from '../enums';

export const vehicleTypeSchema = z.enum(VEHICLE_TYPES);
export const vehicleStatusSchema = z.enum(VEHICLE_STATUSES);
export const vehicleCategorySchema = z.enum(VEHICLE_CATEGORIES);
export const vehicleDocTypeSchema = z.enum(VEHICLE_DOC_TYPES);
export const incidentTypeSchema = z.enum(INCIDENT_TYPES);

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const vehiclePublicSchema = z.object({
  id: z.string(),
  plate_number: z.string(),
  model: z.string(),
  // Registration certificate number off the tech passport ("AAG 1234567").
  tech_passport: z.string().nullable(),
  owner: z.string().nullable(),
  tech_passport_front_url: z.string().nullable(),
  tech_passport_back_url: z.string().nullable(),
  // Year of manufacture.
  model_year: z.number().nullable(),
  type: vehicleTypeSchema,
  capacity_kg: z.number().nullable(),
  length_cm: z.number().nullable(),
  width_cm: z.number().nullable(),
  height_cm: z.number().nullable(),
  category: vehicleCategorySchema.nullable(),
  status: vehicleStatusSchema,
  notes: z.string().nullable(),
  current_km: z.number().nullable(),
  assigned_driver_id: z.string().nullable(),
  assigned_driver_name: z.string().nullable(),
  assigned_driver_phone: z.string().nullable(),
  // Most severe document-expiry state across this vehicle's documents.
  docs_expiry_alert: z.enum(['expired', 'soon']).nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type VehiclePublic = z.infer<typeof vehiclePublicSchema>;

export const kmRecordPublicSchema = z.object({
  id: z.string(),
  vehicle_id: z.string(),
  km: z.number(),
  recorded_by: z.string().nullable(),
  recorded_at: z.string().datetime(),
  photo_url: z.string().nullable().optional(),
  /** What the vision model read off the photo, and the verdict: ok, unread, skipped (no photo). */
  ai_km: z.number().nullable().optional(),
  check_status: z.string().nullable().optional(),
});
export type KmRecordPublic = z.infer<typeof kmRecordPublicSchema>;

export const logKmSchema = z.object({
  // No odometer reads two million; a longer number is a typo (audit, 07.11.2026).
  km: z.number().int().positive().max(2_000_000),
  /** The odometer photo (the driver's weekly reading at the pump). */
  photo_url: photoUrlSchema.optional(),
});

/** Whether the driver is asked for the odometer at this fill: once a week. */
export const kmDueSchema = z.object({
  due: z.boolean(),
  last_km: z.number().int().nullable(),
});
export type KmDue = z.infer<typeof kmDueSchema>;
export type LogKmInput = z.infer<typeof logKmSchema>;

export const vehicleDocumentPublicSchema = z.object({
  id: z.string(),
  vehicle_id: z.string(),
  type: vehicleDocTypeSchema,
  number: z.string().nullable(),
  issued_at: z.string().datetime().nullable(),
  expires_at: z.string().datetime(),
  photo_url: z.string().nullable(),
  holder_name: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type VehicleDocumentPublic = z.infer<typeof vehicleDocumentPublicSchema>;

export const createVehicleDocumentSchema = z.object({
  type: vehicleDocTypeSchema.default('other'),
  number: z.string().optional(),
  issued_at: dateStr.optional(),
  expires_at: dateStr,
  holder_name: z.string().optional(),
  notes: z.string().optional(),
});
export type CreateVehicleDocumentInput = z.infer<typeof createVehicleDocumentSchema>;

export const updateVehicleDocumentSchema = z.object({
  type: vehicleDocTypeSchema.optional(),
  number: z.string().nullish(),
  issued_at: dateStr.nullish(),
  expires_at: dateStr.optional(),
  holder_name: z.string().nullish(),
  notes: z.string().nullish(),
});
export type UpdateVehicleDocumentInput = z.infer<typeof updateVehicleDocumentSchema>;

export const incidentPublicSchema = z.object({
  id: z.string(),
  vehicle_id: z.string(),
  order_id: z.string().nullable(),
  order_number: z.number().nullable(),
  client_name: z.string().nullable(),
  type: incidentTypeSchema,
  description: z.string().nullable(),
  occurred_at: z.string().datetime(),
  reported_by: z.string().nullable(),
  created_at: z.string().datetime(),
});
export type IncidentPublic = z.infer<typeof incidentPublicSchema>;

/** Admin logs an incident against a vehicle. */
export const createIncidentSchema = z.object({
  type: incidentTypeSchema.default('other'),
  description: z.string().optional(),
  occurred_at: dateStr.optional(),
});
export type CreateIncidentInput = z.infer<typeof createIncidentSchema>;

/** Driver reports an incident for their assigned vehicle (optionally tied to an order). */
export const reportIncidentSchema = z.object({
  type: incidentTypeSchema,
  description: z.string().optional(),
  order_id: z.string().optional(),
});
export type ReportIncidentInput = z.infer<typeof reportIncidentSchema>;

export const createVehicleSchema = z.object({
  plate_number: z.string().min(1),
  model: z.string().min(1),
  tech_passport: z.string().nullish(),
  owner: z.string().nullish(),
  model_year: z.number().int().min(1950).max(2100).nullish(),
  type: vehicleTypeSchema.default('other'),
  capacity_kg: z.number().int().positive().nullish(),
  length_cm: z.number().int().positive().nullish(),
  width_cm: z.number().int().positive().nullish(),
  height_cm: z.number().int().positive().nullish(),
  category: vehicleCategorySchema.nullish(),
  notes: z.string().nullish(),
});
export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;

export const updateVehicleSchema = z.object({
  plate_number: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  tech_passport: z.string().nullish(),
  owner: z.string().nullish(),
  model_year: z.number().int().min(1950).max(2100).nullish(),
  type: vehicleTypeSchema.optional(),
  capacity_kg: z.number().int().positive().nullish(),
  length_cm: z.number().int().positive().nullish(),
  width_cm: z.number().int().positive().nullish(),
  height_cm: z.number().int().positive().nullish(),
  category: vehicleCategorySchema.nullish(),
  status: vehicleStatusSchema.optional(),
  notes: z.string().nullish(),
});
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;

/** Search + pagination for the vehicle list. */
export const vehicleFilterSchema = z.object({
  ...paginationSchema.shape,
  search: z.string().optional(),
});
export type VehicleFilterInput = z.infer<typeof vehicleFilterSchema>;

/** A page of vehicles plus the total matching count. */
export const vehiclePageSchema = pageSchema(vehiclePublicSchema);
export type VehiclePage = z.infer<typeof vehiclePageSchema>;

/** One lorry on a document tab of the office's Hujjatlar page: the vehicle,
 *  who drives it, and the latest paper of that kind — or none yet. */
export const documentRowSchema = z.object({
  vehicle_id: z.string(),
  plate_number: z.string(),
  model: z.string(),
  driver_name: z.string().nullable(),
  document: vehicleDocumentPublicSchema.nullable(),
});
export type DocumentRow = z.infer<typeof documentRowSchema>;
