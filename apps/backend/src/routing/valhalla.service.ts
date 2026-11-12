import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type {
  MapMatchRequest,
  RouteRequest,
  RoutingMatrixRequest,
  RoutingMatrixResult,
  RoutingRouteResult,
  RoutingSummary,
} from '@bigant/shared';
import type { Env } from '../config/env.validation';

const valhallaSummarySchema = z
  .object({
    length: z.number().nonnegative(),
    time: z.number().nonnegative(),
    has_toll: z.boolean().optional(),
    has_highway: z.boolean().optional(),
    has_ferry: z.boolean().optional(),
    has_time_restrictions: z.boolean().optional(),
  })
  .passthrough();

const valhallaManeuverSchema = z
  .object({
    type: z.number().int(),
    instruction: z.string(),
    verbal_pre_transition_instruction: z.string().optional(),
    verbal_transition_alert_instruction: z.string().optional(),
    length: z.number().nonnegative(),
    time: z.number().nonnegative(),
    begin_shape_index: z.number().int().nonnegative(),
    end_shape_index: z.number().int().nonnegative(),
    street_names: z.array(z.string()).optional(),
  })
  .passthrough();

const valhallaTripSchema = z.object({
  trip: z
    .object({
      summary: valhallaSummarySchema,
      legs: z.array(
        z
          .object({
            summary: valhallaSummarySchema,
            shape: z.string(),
            maneuvers: z.array(valhallaManeuverSchema).optional(),
          })
          .passthrough(),
      ),
    })
    .passthrough(),
});

const compactMatrixArrays = z.object({
  distances: z.array(z.array(z.number().nonnegative().nullable())),
  durations: z.array(z.array(z.number().nonnegative().nullable())),
});

// With `verbose: false`, Valhalla 3.8 nests the compact arrays under
// `sources_to_targets`; earlier builds returned them at the top level. The
// production instance sends the nested form, which the top-level-only schema
// rejected — every /routing/matrix call returned 502 while the unit tests, built
// on the assumed shape, stayed green. Accept both so a Valhalla upgrade in
// either direction cannot reintroduce that.
const compactMatrixSchema = z.union([
  z
    .object({ sources_to_targets: compactMatrixArrays })
    .transform((body) => body.sources_to_targets),
  compactMatrixArrays,
]);

const verboseMatrixSchema = z.object({
  sources_to_targets: z.array(
    z.array(
      z
        .object({
          distance: z.number().nonnegative().nullable(),
          time: z.number().nonnegative().nullable(),
        })
        .passthrough(),
    ),
  ),
});

const valhallaErrorSchema = z
  .object({
    error_code: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough();

type ValhallaSummary = z.infer<typeof valhallaSummarySchema>;

@Injectable()
export class ValhallaService {
  private readonly logger = new Logger(ValhallaService.name);
  private readonly baseUrl: URL;
  private readonly timeoutMs: number;

  constructor(config: ConfigService<Env, true>) {
    this.baseUrl = new URL(config.get('VALHALLA_URL', { infer: true }));
    this.timeoutMs = config.get('VALHALLA_TIMEOUT_MS', { infer: true });
  }

  async route(input: RouteRequest): Promise<RoutingRouteResult> {
    const payload = await this.request('/route', {
      locations: input.locations.map((location) => ({ ...location, type: 'break' })),
      costing: input.costing,
      ...(input.shortest ? { costing_options: { [input.costing]: { shortest: true } } } : {}),
      shape_format: 'polyline6',
      directions_options: {
        units: 'kilometers',
        language: input.language,
      },
    });

    return this.parseTrip(payload);
  }

  async matrix(input: RoutingMatrixRequest): Promise<RoutingMatrixResult> {
    const payload = await this.request('/sources_to_targets', {
      sources: input.sources,
      targets: input.targets,
      costing: input.costing,
      ...(input.shortest ? { costing_options: { [input.costing]: { shortest: true } } } : {}),
      units: 'kilometers',
      verbose: false,
    });

    const compact = compactMatrixSchema.safeParse(payload);
    if (compact.success) {
      this.assertMatrixDimensions(
        compact.data.distances,
        compact.data.durations,
        input.sources.length,
        input.targets.length,
      );
      return {
        units: 'kilometers',
        distances_km: compact.data.distances,
        times_seconds: compact.data.durations,
      };
    }

    const verbose = verboseMatrixSchema.safeParse(payload);
    if (!verbose.success) {
      throw this.invalidResponse('matrix');
    }

    const distances = verbose.data.sources_to_targets.map((row) =>
      row.map((cell) => cell.distance),
    );
    const times = verbose.data.sources_to_targets.map((row) =>
      row.map((cell) => cell.time),
    );
    this.assertMatrixDimensions(
      distances,
      times,
      input.sources.length,
      input.targets.length,
    );

    return {
      units: 'kilometers',
      distances_km: distances,
      times_seconds: times,
    };
  }

  async match(input: MapMatchRequest): Promise<RoutingRouteResult> {
    const payload = await this.request('/trace_route', {
      shape: input.shape,
      costing: input.costing,
      shape_match: input.shape_match,
      shape_format: 'polyline6',
      directions_options: {
        units: 'kilometers',
        language: input.language,
      },
    });

    return this.parseTrip(payload);
  }

  private async request(path: string, body: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(new URL(path, this.baseUrl), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        this.logger.warn('Valhalla request timed out after ' + this.timeoutMs + 'ms');
        throw new GatewayTimeoutException('routing_service_timeout');
      }
      this.logger.error('Valhalla request failed: ' + (error as Error).message);
      throw new ServiceUnavailableException('routing_service_unavailable');
    } finally {
      clearTimeout(timer);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw this.invalidResponse('json');
    }

    if (!response.ok) {
      const upstream = valhallaErrorSchema.safeParse(payload);
      const upstreamCode = upstream.success ? upstream.data.error_code ?? null : null;
      this.logger.warn(
        'Valhalla returned HTTP ' + response.status + ' (code ' + upstreamCode + ')',
      );
      if (response.status >= 400 && response.status < 500) {
        throw new BadRequestException({
          message: 'routing_request_failed',
          upstream_code: upstreamCode,
        });
      }
      throw new BadGatewayException('routing_service_error');
    }

    return payload;
  }

  private parseTrip(payload: unknown): RoutingRouteResult {
    const parsed = valhallaTripSchema.safeParse(payload);
    if (!parsed.success) {
      throw this.invalidResponse('trip');
    }

    return {
      units: 'kilometers',
      summary: this.toSummary(parsed.data.trip.summary),
      legs: parsed.data.trip.legs.map((leg) => ({
        summary: this.toSummary(leg.summary),
        shape: leg.shape,
        maneuvers: (leg.maneuvers ?? []).map((maneuver) => ({
          type: maneuver.type,
          instruction: maneuver.instruction,
          verbal_instruction:
            maneuver.verbal_pre_transition_instruction ??
            maneuver.verbal_transition_alert_instruction ??
            null,
          length_km: maneuver.length,
          time_seconds: maneuver.time,
          begin_shape_index: maneuver.begin_shape_index,
          end_shape_index: maneuver.end_shape_index,
          street_names: maneuver.street_names ?? [],
        })),
      })),
    };
  }

  private toSummary(summary: ValhallaSummary): RoutingSummary {
    return {
      length_km: summary.length,
      time_seconds: summary.time,
      has_toll: summary.has_toll ?? false,
      has_highway: summary.has_highway ?? false,
      has_ferry: summary.has_ferry ?? false,
      has_time_restrictions: summary.has_time_restrictions ?? false,
    };
  }

  private assertMatrixDimensions(
    distances: Array<Array<number | null>>,
    times: Array<Array<number | null>>,
    sourceCount: number,
    targetCount: number,
  ): void {
    const valid =
      distances.length === sourceCount &&
      times.length === sourceCount &&
      distances.every((row) => row.length === targetCount) &&
      times.every((row) => row.length === targetCount);
    if (!valid) {
      throw this.invalidResponse('matrix_dimensions');
    }
  }

  private invalidResponse(kind: string): BadGatewayException {
    this.logger.warn('Valhalla returned an invalid ' + kind + ' response');
    return new BadGatewayException('routing_invalid_response');
  }
}
