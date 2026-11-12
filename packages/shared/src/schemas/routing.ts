import { z } from 'zod';

export const routingCoordinateSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
});
export type RoutingCoordinate = z.infer<typeof routingCoordinateSchema>;

export const routingCostingSchema = z.enum(['auto', 'truck']);
export type RoutingCosting = z.infer<typeof routingCostingSchema>;

export const routingLanguageSchema = z.enum(['ru-RU', 'en-US']);
export type RoutingLanguage = z.infer<typeof routingLanguageSchema>;

export const routeRequestSchema = z.object({
  locations: z.array(routingCoordinateSchema).min(2).max(20),
  costing: routingCostingSchema.default('auto'),
  language: routingLanguageSchema.default('ru-RU'),
  /** The fewest km rather than the fewest minutes — the office map's road (owner, 30.10.2026). */
  shortest: z.boolean().optional(),
});
export type RouteRequest = z.infer<typeof routeRequestSchema>;

export const routingMatrixRequestSchema = z
  .object({
    sources: z.array(routingCoordinateSchema).min(1).max(25),
    targets: z.array(routingCoordinateSchema).min(1).max(25),
    costing: routingCostingSchema.default('auto'),
    /** The fewest km, as the map's road and the order ETA are measured. */
    shortest: z.boolean().optional(),
  })
  .refine((value) => value.sources.length * value.targets.length <= 100, {
    message: 'matrix_may_contain_at_most_100_pairs',
    path: ['targets'],
  });
export type RoutingMatrixRequest = z.infer<typeof routingMatrixRequestSchema>;

export const mapMatchRequestSchema = z.object({
  shape: z.array(routingCoordinateSchema).min(2).max(500),
  costing: routingCostingSchema.default('auto'),
  language: routingLanguageSchema.default('ru-RU'),
  shape_match: z.enum(['map_snap', 'walk_or_snap']).default('map_snap'),
});
export type MapMatchRequest = z.infer<typeof mapMatchRequestSchema>;

export const routingSummarySchema = z.object({
  length_km: z.number().nonnegative(),
  time_seconds: z.number().nonnegative(),
  has_toll: z.boolean(),
  has_highway: z.boolean(),
  has_ferry: z.boolean(),
  has_time_restrictions: z.boolean(),
});
export type RoutingSummary = z.infer<typeof routingSummarySchema>;

export const routingManeuverSchema = z.object({
  type: z.number().int(),
  instruction: z.string(),
  verbal_instruction: z.string().nullable(),
  length_km: z.number().nonnegative(),
  time_seconds: z.number().nonnegative(),
  begin_shape_index: z.number().int().nonnegative(),
  end_shape_index: z.number().int().nonnegative(),
  street_names: z.array(z.string()),
});
export type RoutingManeuver = z.infer<typeof routingManeuverSchema>;

export const routingLegSchema = z.object({
  summary: routingSummarySchema,
  shape: z.string(),
  maneuvers: z.array(routingManeuverSchema),
});
export type RoutingLeg = z.infer<typeof routingLegSchema>;

export const routingRouteResultSchema = z.object({
  units: z.literal('kilometers'),
  summary: routingSummarySchema,
  legs: z.array(routingLegSchema),
});
export type RoutingRouteResult = z.infer<typeof routingRouteResultSchema>;

const nullableNumberMatrixSchema = z.array(z.array(z.number().nonnegative().nullable()));

export const routingMatrixResultSchema = z.object({
  units: z.literal('kilometers'),
  distances_km: nullableNumberMatrixSchema,
  times_seconds: nullableNumberMatrixSchema,
});
export type RoutingMatrixResult = z.infer<typeof routingMatrixResultSchema>;

/** The office map's "yo'l ko'rsatish": the road from one point to another, drawn. */
export const mapRouteQuerySchema = z.object({
  from_lat: z.coerce.number().min(-90).max(90),
  from_lon: z.coerce.number().min(-180).max(180),
  to_lat: z.coerce.number().min(-90).max(90),
  to_lon: z.coerce.number().min(-180).max(180),
});
export type MapRouteQuery = z.infer<typeof mapRouteQuerySchema>;

export const mapRouteResultSchema = z.object({
  length_km: z.number().nonnegative(),
  time_seconds: z.number().nonnegative(),
  /** [lon, lat] pairs along the road, ready for the map. */
  coordinates: z.array(z.tuple([z.number(), z.number()])),
});
export type MapRouteResult = z.infer<typeof mapRouteResultSchema>;

/** The office map's "eng yaqin mashina": how far each lorry is from one point by road. */
export const mapNearestRequestSchema = z.object({
  to: routingCoordinateSchema,
  from: z.array(routingCoordinateSchema).min(1).max(50),
});
export type MapNearestRequest = z.infer<typeof mapNearestRequestSchema>;

export const mapNearestResultSchema = z.object({
  /** Same order as `from`; null where no road connects. */
  legs: z.array(z.object({ length_km: z.number().nullable(), time_seconds: z.number().nullable() })),
});
export type MapNearestResult = z.infer<typeof mapNearestResultSchema>;

/**
 * A lorry on the office map, pressed (owner, 30.10.2026): which street,
 * district and region it is in now, and the road from there to the stop its
 * driver has to reach next — drawn, with the km and minutes left.
 */
export const driverMapTripSchema = z.object({
  /** "Amir Temur ko'chasi, Yunusobod tumani, Toshkent" — null when the address service is down. */
  here: z.string().nullable(),
  /** No road shown because the lorry is on another seller's work (a seller is looking). */
  busy_elsewhere: z.boolean().optional(),
  trip: z
    .object({
      next_kind: z.enum(['pickup', 'client', 'return']),
      /** Where he is going; null for a seller looking at another seller's work. */
      next_name: z.string().nullable(),
      next_km: z.number(),
      next_seconds: z.number(),
      /** Every stop still ahead, to the last client. */
      total_km: z.number(),
      total_seconds: z.number(),
      stops: z.number().int(),
      /**
       * Every stop ahead in driving order — two pickups and then the client,
       * say — each with the km and minutes from the stop before it (the first
       * from where he is) and where it is, for its numbered pin.
       */
      legs: z.array(
        z.object({
          kind: z.enum(['pickup', 'client', 'return']),
          name: z.string().nullable(),
          km: z.number(),
          seconds: z.number(),
          lat: z.number(),
          lng: z.number(),
        }),
      ),
      /** [lon, lat] pairs along the road from him through every stop. */
      coordinates: z.array(z.tuple([z.number(), z.number()])),
    })
    .nullable(),
});
export type DriverMapTrip = z.infer<typeof driverMapTripSchema>;
