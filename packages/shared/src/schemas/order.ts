import { photoUrlSchema } from './photo-url';
import { z } from 'zod';
import { vozvratItemSchema } from './vozvrat';
import {
  DRIVER_NEXT_ACTIONS,
  ITEM_COLLECTION_STATUSES,
  LEG_STATUSES,
  ORDER_EXCEPTION_REASONS,
  ORDER_PRIORITIES,
  ORDER_STATUSES,
  RETURN_DESTINATIONS,
  RETURN_STAGES,
  ORDER_KINDS,
} from '../enums';
import { CARRY_OVER_REASONS } from './driver';

export const orderPrioritySchema = z.enum(ORDER_PRIORITIES);
export const orderStatusSchema = z.enum(ORDER_STATUSES);
export const itemCollectionStatusSchema = z.enum(ITEM_COLLECTION_STATUSES);
export const legStatusSchema = z.enum(LEG_STATUSES);
export const driverNextActionKindSchema = z.enum(DRIVER_NEXT_ACTIONS);
export const orderKindSchema = z.enum(ORDER_KINDS);
export const returnDestinationSchema = z.enum(RETURN_DESTINATIONS);

/** Non-terminal Istisno report: required predefined reason + optional comment. */
export const orderExceptionSchema = z.object({
  reason: z.enum(ORDER_EXCEPTION_REASONS),
  comment: z.string().trim().max(500).nullish(),
});
export type OrderExceptionInput = z.infer<typeof orderExceptionSchema>;

/** Vozrat (return) — a destination for every collected pickup plus an optional
 *  reason. Each return is later completed separately with mandatory photo proof. */
export const orderReturnSchema = z.object({
  returns: z
    .array(
      z.object({
        pickup_source_id: z.string().min(1),
        // Left out by the driver: the seller says where the goods go.
        destination: returnDestinationSchema.optional(),
      }),
    )
    .min(1),
  reason: z.string().trim().max(500).nullish(),
  // What is being returned and why, product by product. The app always sends
  // it; optional only so an older app can still start a return.
  items: z.array(vozvratItemSchema).min(1).max(50).optional(),
});
export type OrderReturnInput = z.infer<typeof orderReturnSchema>;

/** Confirm goods collected. A proof photo is required; its comment is optional. */
export const pickupLoadedSchema = z.object({
  photo_url: photoUrlSchema,
  comment: z.string().trim().max(500).nullish(),
});
export type PickupLoadedInput = z.infer<typeof pickupLoadedSchema>;

export const orderReturnCompleteSchema = z.object({
  photo_url: photoUrlSchema,
  comment: z.string().trim().max(500).nullish(),
});
export type OrderReturnCompleteInput = z.infer<typeof orderReturnCompleteSchema>;

export const orderItemInputSchema = z.object({
  product_name: z.string().min(1),
  quantity: z.number().int().positive(),
  pickup_place_id: z.string().min(1),
});
export type OrderItemInput = z.infer<typeof orderItemInputSchema>;

export const createOrderSchema = z.object({
  client_id: z.string().min(1),
  /**
   * Which of the client's places this goes to. Left out means the default
   * one, which is what a client with a single address always has — so a form
   * that never asks keeps working.
   */
  client_address_id: z.string().min(1).nullish(),
  delivery_datetime: z.string().datetime(),
  comment: z.string().optional(),
  priority: orderPrioritySchema.optional(),
  // Delivery region/district are inherited from the customer — not chosen on the order.
  items: z.array(orderItemInputSchema).min(1),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const cancelOrderSchema = z.object({
  reason: z.string().min(1),
});
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;

export const deliverOrderSchema = z.object({
  photo_url: photoUrlSchema,
  comment: z.string().trim().max(500).nullish(),
});
export type DeliverOrderInput = z.infer<typeof deliverOrderSchema>;

/** Order list filters (§16). All optional; combined with the role scope. */
export const orderFilterSchema = z.object({
  status: orderStatusSchema.optional(),
  statuses: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : undefined)),
  driver_id: z.string().optional(),
  seller_id: z.string().optional(),
  client_id: z.string().optional(),
  client_phone: z.string().optional(),
  delivery_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
    .optional(),
  delivery_date_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
    .optional(),
  delivery_date_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
    .optional(),
  pickup_place_id: z.string().optional(),
  problem: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  skip: z.coerce.number().int().min(0).optional(),
  take: z.coerce.number().int().min(1).max(500).optional(),
});
export type OrderFilterInput = z.infer<typeof orderFilterSchema>;

export const orderItemPublicSchema = z.object({
  id: z.string(),
  product_name: z.string(),
  quantity: z.number(),
  pickup_place_id: z.string(),
  pickup_place_name: z.string(),
  collection_status: itemCollectionStatusSchema,
  problem_reason: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type OrderItemPublic = z.infer<typeof orderItemPublicSchema>;

/** One stop on the driver's journey — a pickup place, ordered by `position`.
 *  `leg_status` drives the "Heading to / Arrived at pickup N" buttons (Option A). */
export const orderPickupSourcePublicSchema = z.object({
  id: z.string(),
  pickup_place_id: z.string(),
  name: z.string(),
  /** The place's phone, for the driver to ring before he arrives (owner, 11.11.2026). */
  phone_number: z.string().nullable().optional(),
  position: z.number().int(),
  leg_status: legStatusSchema,
  region_name: z.string().nullable(),
  district_name: z.string().nullable(),
  // Snapshotted from the pickup place at creation; null for orders that predate pins.
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  // Position in the driver's merged trip; null unless this order is co-loaded
  // with another. Lets the app draw one route across two orders.
  trip_position: z.number().int().nullable(),
  // Photo of the loaded goods, taken when the driver marks this stop loaded.
  load_photo_url: z.string().nullable(),
  return_required: z.boolean(),
  return_destination: returnDestinationSchema.nullable(),
  /** Where the return goes, as a place: BIGANT sklad / BIGANT do'kon, or this stop for Ta'minotchi. */
  return_place: z
    .object({
      name: z.string(),
      address: z.string().nullable(),
      lat: z.number().nullable(),
      lng: z.number().nullable(),
      // The place's phone, for the driver's call button (owner, 12.11.2026).
      phone_number: z.string().nullable().optional(),
      // The supplier's place picked by the seller, when there is one.
      place_id: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  return_stage: z.enum(RETURN_STAGES).nullable(),
  return_proof_photo_url: z.string().nullable(),
  returned_at: z.string().datetime().nullable(),
});
export type OrderPickupSourcePublic = z.infer<typeof orderPickupSourcePublicSchema>;

/** The single next action the assigned driver can take, computed server-side.
 *  For pickup actions, `pickup_*` identify which stop; otherwise they are null. */
export const driverNextActionSchema = z.object({
  type: driverNextActionKindSchema,
  pickup_id: z.string().nullable(),
  pickup_name: z.string().nullable(),
  pickup_position: z.number().int().nullable(),
});
export type DriverNextAction = z.infer<typeof driverNextActionSchema>;

/** Aggregate order counts by status, for dashboards (avoids fetching all rows). */
export const orderStatsSchema = z.object({
  total: z.number(),
  counts: z.record(z.string(), z.number()),
});
export type OrderStats = z.infer<typeof orderStatsSchema>;

/** One line of what came back, as the driver wrote it — what the seller checks. */
export const returnItemPublicSchema = z.object({
  id: z.string(),
  name: z.string(),
  unit: z.string().nullable(),
  quantity: z.number(),
  condition: z.string(),
  reason_code: z.string(),
  other_reason: z.string().nullable(),
  culprit: z.string().nullable(),
  photo_url: z.string(),
  /** The further photos of the same product, after photo_url. */
  photo_urls: z.array(z.string()).optional(),
});
export type ReturnItemPublic = z.infer<typeof returnItemPublicSchema>;

/**
 * The seller confirms the driver's write-up — as it is, or with his own
 * account beside it (who he says is to blame, in his words). Either way the
 * driver carries on with the return.
 */
export const returnItemsConfirmSchema = z
  .object({
    seller_culprit: z.enum(['sotuvchi', 'mijoz', 'omborchi', 'haydovchi']).nullish(),
    seller_note: z.string().trim().max(500).nullish(),
    /** Where each returned stop's goods go — the seller decides, not the driver. */
    destinations: z
      .array(
        z.object({
          pickup_source_id: z.string().min(1),
          destination: returnDestinationSchema,
          // Ta'minotchi: the supplier's place picked from the list (owner, 12.11.2026).
          place_id: z.string().min(1).nullish(),
        }),
      )
      .max(10)
      .optional(),
  })
  .default({});
export type ReturnItemsConfirmInput = z.infer<typeof returnItemsConfirmSchema>;

/** The seller's words when he sends a write-up back to the driver. */
export const returnItemsRejectSchema = z.object({
  reason: z.string().trim().min(1).max(300),
});
export type ReturnItemsRejectInput = z.infer<typeof returnItemsRejectSchema>;

export const orderPublicSchema = z.object({
  id: z.string(),
  kind: orderKindSchema,
  original_order_id: z.string().nullable(),
  original_order_number: z.number().int().nullable(),
  order_number: z.number(),
  // Where the order sits in its lorry's queue for the day (1 = first); null
  // when it was not booked through the seller board.
  queue_position: z.number().int().nullable(),
  client_id: z.string(),
  /** Which of the client's places this is for; null for an older order. */
  client_address_id: z.string().nullable(),
  /** The place's name ("Chilonzor filiali"), for people who know it by that. */
  client_address_label: z.string().nullable(),
  client_name: z.string(),
  client_phone_number: z.string(),
  client_address: z.string(),
  delivery_datetime: z.string().datetime(),
  // Future seller bookings become actionable at 03:00 Asia/Tashkent on their day.
  actions_available_at: z.string().datetime().nullable(),
  comment: z.string().nullable(),
  priority: orderPrioritySchema,
  status: orderStatusSchema,
  cancellation_reason: z.string().nullable(),
  /** The latest "not today, tomorrow" the driver gave, while the order is still open. */
  carried_over: z
    .object({
      reason: z.enum(CARRY_OVER_REASONS),
      comment: z.string().nullable(),
      at: z.string().datetime(),
    })
    .nullable(),
  // Istisno (exception) reason, order-level.
  problem_reason: z.string().nullable(),
  problem_comment: z.string().nullable(),
  // Vozrat (return) details.
  return_reason: z.string().nullable(),
  return_destination: returnDestinationSchema.nullable(),
  // Vozrat return-trip stage: null=carrying, then 'heading' → 'arrived' → returned.
  return_stage: z.enum(RETURN_STAGES).nullable(),
  // Proof photo taken at hand-back (also posted to the Vozrat Telegram group).
  return_proof_photo_url: z.string().nullable(),
  returned_at: z.string().datetime().nullable(),
  /**
   * The seller's check on what the driver wrote up. The goods go on his
   * account, so the return legs wait here: `return_items_written` says there
   * is a list, and until it is confirmed the driver's next action is to wait
   * (or, if it came back, to write it again with `return_items_reject_reason`
   * in front of him).
   */
  return_items_written: z.number().int(),
  return_items_confirmed_at: z.string().datetime().nullable(),
  return_items_confirmed_by: z.string().nullable(),
  return_items_rejected_at: z.string().datetime().nullable(),
  return_items_reject_reason: z.string().nullable(),
  /** The seller's own account, when he gave one on confirming. */
  return_seller_culprit: z.string().nullable().optional(),
  /** The driver set the return aside to do the next order first (Ojidaniya). */
  return_deferred_at: z.string().datetime().nullable().optional(),
  /** Ertangi booked for after 09:00. */
  start_after_nine: z.boolean().optional(),
  return_seller_note: z.string().nullable().optional(),
  proof_photo_url: z.string().nullable(),
  created_by_seller_id: z.string(),
  created_by_seller_name: z.string().nullable(),
  created_by_seller_phone_number: z.string().nullable(),
  assigned_driver_id: z.string().nullable(),
  assigned_driver_name: z.string().nullable(),
  // Official geo (snapshotted from the customer): region + Tashkent-only district.
  region_code: z.string().nullable(),
  region_name: z.string().nullable(),
  district_code: z.string().nullable(),
  district_name: z.string().nullable(),
  // Delivery point, snapshotted from the client at creation; null for older orders.
  delivery_lat: z.number().nullable(),
  delivery_lng: z.number().nullable(),
  /** This order's client stop in the merged trip; null unless co-loaded. */
  delivery_trip_position: z.number().int().nullable(),
  is_city: z.boolean(),
  // Cargo summary shown on the driver's journey card (YUK / OG'IRLIK / NAKLADNOY).
  cargo_type_name: z.string().nullable(),
  weight_kg: z.number().int().nullable(),
  waybill_source: z.string().nullable(),
  items: z.array(orderItemPublicSchema),
  // Ordered pickup stops (Option A place-based journey) + the driver's next action.
  pickup_sources: z.array(orderPickupSourcePublicSchema),
  next_action: driverNextActionSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type OrderPublic = z.infer<typeof orderPublicSchema>;

/** A page of orders plus the total matching count — for server-side pagination. */
export const orderPageSchema = z.object({
  items: z.array(orderPublicSchema),
  total: z.number().int(),
});
export type OrderPage = z.infer<typeof orderPageSchema>;

/**
 * A vozvrat order: goods a client gives back days after a delivery. The
 * driver goes to the client, writes up what comes back, and takes it to the
 * place it belongs to. The seller whose goods they are is taken from the
 * original order when one is named.
 */
export const createVozvratOrderSchema = z.object({
  client_id: z.string().min(1),
  /** Which of the client's places the goods are collected from. */
  client_address_id: z.string().min(1).nullish(),
  /** The delivery it comes from, when known — must be this client's. */
  original_order_id: z.string().min(1).nullish(),
  /** Where the goods go back to (its type decides warehouse / store / supplier). */
  pickup_place_id: z.string().min(1),
  /** When to fetch them; now when left out. */
  pickup_datetime: z.string().datetime().nullish(),
  comment: z.string().trim().max(500).nullish(),
});
export type CreateVozvratOrderInput = z.infer<typeof createVozvratOrderSchema>;
