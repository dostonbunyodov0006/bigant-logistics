import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  mapMatchRequestSchema,
  routeRequestSchema,
  routingMatrixRequestSchema,
} from '@bigant/shared';
import type { Env } from '../config/env.validation';
import { ValhallaService } from './valhalla.service';

function config(timeoutMs = 10_000): ConfigService<Env, true> {
  const values = {
    VALHALLA_URL: 'http://valhalla:8002',
    VALHALLA_TIMEOUT_MS: timeoutMs,
  };
  return {
    get: jest.fn((key: keyof typeof values) => values[key]),
  } as unknown as ConfigService<Env, true>;
}

function response(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

const summary = {
  length: 5.481,
  time: 388.269,
  has_toll: false,
  has_highway: true,
};

const tripPayload = {
  trip: {
    summary,
    legs: [
      {
        summary,
        shape: 'encoded-polyline6',
        maneuvers: [
          {
            type: 1,
            instruction: 'Drive east.',
            verbal_pre_transition_instruction: 'Drive east.',
            length: 5.481,
            time: 388.269,
            begin_shape_index: 0,
            end_shape_index: 12,
            street_names: ['Amir Temur shoh kochasi'],
          },
        ],
      },
    ],
  },
};

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('ValhallaService', () => {
  it('asks for the fewest km when the shortest road is wanted, and nothing extra otherwise', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(response(tripPayload)));
    const service = new ValhallaService(config());
    const locations = [
      { lat: 41.2995, lon: 69.2401 },
      { lat: 41.3111, lon: 69.2797 },
    ];

    await service.route({ locations, costing: 'auto', language: 'ru-RU', shortest: true });
    await service.route({ locations, costing: 'auto', language: 'ru-RU' });

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).costing_options).toEqual({ auto: { shortest: true } });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).costing_options).toBeUndefined();
    fetchMock.mockRestore();
  });

  it('requests a route and normalizes the Valhalla trip', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(response(tripPayload));
    const service = new ValhallaService(config());

    const result = await service.route({
      locations: [
        { lat: 41.2995, lon: 69.2401 },
        { lat: 41.3111, lon: 69.2797 },
      ],
      costing: 'truck',
      language: 'ru-RU',
    });

    expect(String(fetchMock.mock.calls[0][0])).toBe('http://valhalla:8002/route');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      locations: [
        { lat: 41.2995, lon: 69.2401, type: 'break' },
        { lat: 41.3111, lon: 69.2797, type: 'break' },
      ],
      costing: 'truck',
      shape_format: 'polyline6',
      directions_options: {
        units: 'kilometers',
        language: 'ru-RU',
      },
    });
    expect(result).toEqual({
      units: 'kilometers',
      summary: {
        length_km: 5.481,
        time_seconds: 388.269,
        has_toll: false,
        has_highway: true,
        has_ferry: false,
        has_time_restrictions: false,
      },
      legs: [
        {
          summary: {
            length_km: 5.481,
            time_seconds: 388.269,
            has_toll: false,
            has_highway: true,
            has_ferry: false,
            has_time_restrictions: false,
          },
          shape: 'encoded-polyline6',
          maneuvers: [
            {
              type: 1,
              instruction: 'Drive east.',
              verbal_instruction: 'Drive east.',
              length_km: 5.481,
              time_seconds: 388.269,
              begin_shape_index: 0,
              end_shape_index: 12,
              street_names: ['Amir Temur shoh kochasi'],
            },
          ],
        },
      ],
    });
  });

  it('returns a compact travel-time matrix', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      response({
        distances: [
          [0, 5.482],
          [5.411, 0],
        ],
        durations: [
          [0, 388],
          [401, 0],
        ],
      }),
    );
    const service = new ValhallaService(config());

    const result = await service.matrix({
      sources: [
        { lat: 41.2995, lon: 69.2401 },
        { lat: 41.3111, lon: 69.2797 },
      ],
      targets: [
        { lat: 41.2995, lon: 69.2401 },
        { lat: 41.3111, lon: 69.2797 },
      ],
      costing: 'auto',
    });

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'http://valhalla:8002/sources_to_targets',
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      costing: 'auto',
      units: 'kilometers',
      verbose: false,
    });
    expect(result).toEqual({
      units: 'kilometers',
      distances_km: [
        [0, 5.482],
        [5.411, 0],
      ],
      times_seconds: [
        [0, 388],
        [401, 0],
      ],
    });
  });

  it('parses the nested compact matrix that Valhalla 3.8 actually returns', async () => {
    // Verbatim from the production instance (3.8.3, verbose:false), extra keys
    // included. The previous mock used a top-level shape Valhalla no longer
    // sends, so this endpoint returned 502 in production while tests passed.
    jest.spyOn(global, 'fetch').mockResolvedValue(
      response({
        sources_to_targets: { durations: [[939]], distances: [[14.613]] },
        units: 'kilometers',
        algorithm: 'costmatrix',
      }),
    );
    const service = new ValhallaService(config());

    await expect(
      service.matrix({
        sources: [{ lat: 41.2856, lon: 69.2034 }],
        targets: [{ lat: 41.3667, lon: 69.2897 }],
        costing: 'auto',
      }),
    ).resolves.toEqual({
      units: 'kilometers',
      distances_km: [[14.613]],
      times_seconds: [[939]],
    });
  });

  it('still rejects a nested matrix whose dimensions do not match the request', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      response({ sources_to_targets: { durations: [[939]], distances: [[14.613]] } }),
    );
    const service = new ValhallaService(config());

    // One source, two targets requested — a 1x1 answer must not be accepted.
    await expect(
      service.matrix({
        sources: [{ lat: 41.2856, lon: 69.2034 }],
        targets: [
          { lat: 41.3667, lon: 69.2897 },
          { lat: 41.3111, lon: 69.2797 },
        ],
        costing: 'auto',
      }),
    ).rejects.toThrow();
  });

  it('supports Valhalla verbose matrix responses', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      response({
        sources_to_targets: [
          [
            { distance: 0, time: 0 },
            { distance: 5.482, time: 388 },
          ],
        ],
      }),
    );
    const service = new ValhallaService(config());

    await expect(
      service.matrix({
        sources: [{ lat: 41.2995, lon: 69.2401 }],
        targets: [
          { lat: 41.2995, lon: 69.2401 },
          { lat: 41.3111, lon: 69.2797 },
        ],
        costing: 'auto',
      }),
    ).resolves.toEqual({
      units: 'kilometers',
      distances_km: [[0, 5.482]],
      times_seconds: [[0, 388]],
    });
  });

  it('sends a GPS trace to the map-matching endpoint', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(response(tripPayload));
    const service = new ValhallaService(config());

    await service.match({
      shape: [
        { lat: 41.2995, lon: 69.2401 },
        { lat: 41.3111, lon: 69.2797 },
      ],
      costing: 'auto',
      language: 'en-US',
      shape_match: 'walk_or_snap',
    });

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'http://valhalla:8002/trace_route',
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      costing: 'auto',
      shape_match: 'walk_or_snap',
      shape_format: 'polyline6',
    });
  });

  it('maps rejected routes to a controlled bad-request response', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(response({ error_code: 442 }, false, 400));
    const service = new ValhallaService(config());

    await expect(
      service.route({
        locations: [
          { lat: 41.2995, lon: 69.2401 },
          { lat: 41.3111, lon: 69.2797 },
        ],
        costing: 'auto',
        language: 'ru-RU',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects malformed successful responses', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(response({ trip: {} }));
    const service = new ValhallaService(config());

    await expect(
      service.route({
        locations: [
          { lat: 41.2995, lon: 69.2401 },
          { lat: 41.3111, lon: 69.2797 },
        ],
        costing: 'auto',
        language: 'ru-RU',
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('returns service unavailable when Valhalla cannot be reached', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('connection refused'));
    const service = new ValhallaService(config());

    await expect(
      service.match({
        shape: [
          { lat: 41.2995, lon: 69.2401 },
          { lat: 41.3111, lon: 69.2797 },
        ],
        costing: 'auto',
        language: 'ru-RU',
        shape_match: 'map_snap',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('aborts a Valhalla request after the configured timeout', async () => {
    jest.useFakeTimers();
    jest.spyOn(global, 'fetch').mockImplementation((_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    );
    const service = new ValhallaService(config(50));

    const result = expect(
      service.route({
        locations: [
          { lat: 41.2995, lon: 69.2401 },
          { lat: 41.3111, lon: 69.2797 },
        ],
        costing: 'auto',
        language: 'ru-RU',
      }),
    ).rejects.toBeInstanceOf(GatewayTimeoutException);
    await jest.advanceTimersByTimeAsync(50);
    await result;
  });
});

describe('routing request schemas', () => {
  it('applies safe routing defaults', () => {
    expect(
      routeRequestSchema.parse({
        locations: [
          { lat: 41.2995, lon: 69.2401 },
          { lat: 41.3111, lon: 69.2797 },
        ],
      }),
    ).toMatchObject({
      costing: 'auto',
      language: 'ru-RU',
    });
    expect(
      mapMatchRequestSchema.parse({
        shape: [
          { lat: 41.2995, lon: 69.2401 },
          { lat: 41.3111, lon: 69.2797 },
        ],
      }),
    ).toMatchObject({
      costing: 'auto',
      language: 'ru-RU',
      shape_match: 'map_snap',
    });
  });

  it('rejects coordinates outside valid ranges', () => {
    expect(
      routeRequestSchema.safeParse({
        locations: [
          { lat: 91, lon: 69.2401 },
          { lat: 41.3111, lon: 69.2797 },
        ],
      }).success,
    ).toBe(false);
  });

  it('limits a matrix to 100 source-target pairs', () => {
    const sources = Array.from({ length: 11 }, () => ({ lat: 41.3, lon: 69.2 }));
    const targets = Array.from({ length: 10 }, () => ({ lat: 41.4, lon: 69.3 }));

    expect(routingMatrixRequestSchema.safeParse({ sources, targets }).success).toBe(false);
  });
});
