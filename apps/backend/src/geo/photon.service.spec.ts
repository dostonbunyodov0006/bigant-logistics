import {
  BadGatewayException,
  GatewayTimeoutException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  geocodingSearchQuerySchema,
  reverseGeocodingQuerySchema,
} from '@bigant/shared';
import type { Env } from '../config/env.validation';
import { PhotonService } from './photon.service';

function config(timeoutMs = 5_000): ConfigService<Env, true> {
  const values = {
    PHOTON_URL: 'http://photon:2322',
    PHOTON_TIMEOUT_MS: timeoutMs,
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

const photonPayload = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [69.2401, 41.2995],
      },
      properties: {
        name: 'Chorsu',
        country: 'O‘zbekiston',
        countrycode: 'uz',
        state: 'Toshkent',
        city: 'Toshkent',
        district: 'Shayxontohur',
        street: 'Beruniy',
        housenumber: '5',
        postcode: '100011',
        osm_type: 'N',
        osm_id: 123,
        osm_key: 'place',
        osm_value: 'market',
      },
    },
  ],
};

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('PhotonService', () => {
  it('searches only Uzbekistan and normalizes Photon GeoJSON', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(response(photonPayload));
    const service = new PhotonService(config());

    const result = await service.search({
      q: 'Chorsu',
      lang: 'uz',
      limit: 5,
      lat: 41.31,
      lon: 69.28,
    });

    const requestedUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestedUrl.pathname).toBe('/api');
    expect(requestedUrl.searchParams.get('q')).toBe('Chorsu');
    expect(requestedUrl.searchParams.get('countrycode')).toBe('UZ');
    expect(requestedUrl.searchParams.get('lang')).toBe('uz');
    expect(requestedUrl.searchParams.get('limit')).toBe('5');
    expect(requestedUrl.searchParams.get('lat')).toBe('41.31');
    expect(requestedUrl.searchParams.get('lon')).toBe('69.28');
    expect(result).toEqual([
      {
        id: 'N:123',
        label: 'Chorsu, Beruniy 5, Shayxontohur, Toshkent, O‘zbekiston',
        name: 'Chorsu',
        latitude: 41.2995,
        longitude: 69.2401,
        country: 'O‘zbekiston',
        country_code: 'UZ',
        // The boundary says where the point is, whatever the map labelled it.
        state: null,
        county: null,
        city: 'Toshkent',
        district: 'Chilonzor tumani',
        street: 'Beruniy',
        house_number: '5',
        postcode: '100011',
        osm_type: 'N',
        osm_id: 123,
        osm_key: 'place',
        osm_value: 'market',
      },
    ]);
  });

  it('a district typed by name leads the list, ahead of a street of the same name (owner, 03.11.2026)', async () => {
    const district = {
      ...photonPayload.features[0],
      geometry: { type: 'Point', coordinates: [69.2, 41.23] },
      properties: { ...photonPayload.features[0].properties, name: 'Yangi hayot tumani', osm_type: 'R', osm_id: 77, osm_key: 'place', osm_value: 'district', street: undefined, housenumber: undefined },
    };
    jest.spyOn(global, 'fetch').mockImplementation((input) => {
      const u = new URL(String(input));
      const mahalla = { ...district, properties: { ...district.properties, name: 'Yangihayot mahallasi', osm_id: 78, osm_key: 'boundary', osm_value: 'administrative' } };
      expect(u.searchParams.get('osm_tag') ? u.searchParams.get('lat') : '41.31').toBe(u.searchParams.get('osm_tag') ? null : '41.31');
      return Promise.resolve(response(u.searchParams.get('osm_tag') ? { type: 'FeatureCollection', features: [mahalla, district] } : photonPayload));
    });
    const service = new PhotonService(config());
    const result = await service.search({ q: 'Yangihayot', lang: 'uz', limit: 5, lat: 41.31, lon: 69.28 });
    // The district leads; the mahalla of the same name is left to the ordinary ranking.
    expect(result.map((r) => r.name)).toEqual(['Yangi hayot tumani', 'Chorsu']);
  });

  it('builds a reverse-geocoding request', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(response(photonPayload));
    const service = new PhotonService(config());

    await service.reverse({ lat: 41.2995, lon: 69.2401, lang: 'ru', limit: 1 });

    const requestedUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestedUrl.pathname).toBe('/reverse');
    expect(requestedUrl.searchParams.get('lat')).toBe('41.2995');
    expect(requestedUrl.searchParams.get('lon')).toBe('69.2401');
    expect(requestedUrl.searchParams.get('lang')).toBe('ru');
    expect(requestedUrl.searchParams.get('limit')).toBe('1');
  });

  it('returns a controlled bad-gateway error for invalid Photon data', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(response({ features: [{ broken: true }] }));
    const service = new PhotonService(config());

    await expect(
      service.search({ q: 'Toshkent', lang: 'uz', limit: 5 }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('returns service unavailable when Photon cannot be reached', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('connection refused'));
    const service = new PhotonService(config());

    await expect(
      service.search({ q: 'Toshkent', lang: 'uz', limit: 5 }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('aborts a Photon request after the configured timeout', async () => {
    jest.useFakeTimers();
    jest.spyOn(global, 'fetch').mockImplementation((_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    );
    const service = new PhotonService(config(50));

    const result = expect(
      service.search({ q: 'Toshkent', lang: 'uz', limit: 5 }),
    ).rejects.toBeInstanceOf(GatewayTimeoutException);
    await jest.advanceTimersByTimeAsync(50);
    await result;
  });
});

describe('geocoding query schemas', () => {
  it('trims search text and applies safe defaults', () => {
    expect(geocodingSearchQuerySchema.parse({ q: '  Toshkent  ' })).toEqual({
      q: 'Toshkent',
      lang: 'uz',
      limit: 5,
    });
  });

  it('requires both location-bias coordinates together', () => {
    expect(
      geocodingSearchQuerySchema.safeParse({ q: 'Toshkent', lat: 41.3 }).success,
    ).toBe(false);
  });

  it('rejects coordinates outside valid ranges', () => {
    expect(
      reverseGeocodingQuerySchema.safeParse({ lat: 91, lon: 69.2 }).success,
    ).toBe(false);
  });
});
