import {
  createClientSchema,
  createPickupPlaceSchema,
  isWithinUzbekistan,
  updateClientSchema,
  updatePickupPlaceSchema,
} from '@bigant/shared';

const TASHKENT = { lat: 41.2995, lng: 69.2401 };
const client = { name: 'Barakat', phone_number: '+998901234567', region_code: '1726' };
// 1726 = Tashkent city, a "city" region where a district is mandatory.
const place = { name: 'Sklad', type: 'warehouse' as const, region_code: '1726', district_code: '1726-01' };

function issues(result: { success: boolean; error?: { issues: { message: string; path: unknown[] }[] } }) {
  return result.success ? [] : (result.error?.issues ?? []).map((i) => `${i.path.join('.')}:${i.message}`);
}

describe('coordinate validation', () => {
  it('accepts a full pair inside the service area', () => {
    expect(createClientSchema.safeParse({ ...client, ...TASHKENT }).success).toBe(true);
    expect(createPickupPlaceSchema.safeParse({ ...place, ...TASHKENT }).success).toBe(true);
  });

  it('takes a client with no pin: a one-off order must not wait on a map', () => {
    // The order then has no ETA and no route for the driver, which is the
    // seller's call to make — refusing the order outright is not.
    expect(createClientSchema.safeParse(client).success).toBe(true);
  });

  it('still requires a pin for a pickup place: every order starts there', () => {
    const p = issues(createPickupPlaceSchema.safeParse(place));
    // Both halves reported, so the form can highlight the picker once.
    expect(p.map((i) => i.split(':')[0]).sort()).toEqual(['lat', 'lng']);
  });

  it('keeps the pin optional on update, so a legacy row can be edited before it is pinned', () => {
    expect(updateClientSchema.safeParse({ name: 'Renamed' }).success).toBe(true);
    expect(updatePickupPlaceSchema.safeParse({ name: 'Renamed' }).success).toBe(true);
  });

  it('rejects half a coordinate and names the missing half', () => {
    // On create the missing half fails as a required field; on update, where
    // both are optional, the pair rule is what catches it. Either way the path
    // points at the half that is absent.
    expect(issues(createClientSchema.safeParse({ ...client, lat: TASHKENT.lat }))).toEqual([
      'lng:coordinates_require_both_lat_and_lng',
    ]);
    expect(issues(createPickupPlaceSchema.safeParse({ ...place, lat: TASHKENT.lat })).map((i) => i.split(':')[0])).toEqual(['lng']);
    expect(issues(updateClientSchema.safeParse({ lat: TASHKENT.lat }))).toEqual([
      'lng:coordinates_require_both_lat_and_lng',
    ]);
    expect(issues(updatePickupPlaceSchema.safeParse({ lng: TASHKENT.lng }))).toEqual([
      'lat:coordinates_require_both_lat_and_lng',
    ]);
  });

  it('rejects a swapped lat/lng — the classic picker bug — because it lands outside Uzbekistan', () => {
    // Tashkent with the axes swapped: 69.24 N, 41.30 E is in the Arctic Ocean off Siberia.
    const swapped = { lat: TASHKENT.lng, lng: TASHKENT.lat };
    expect(isWithinUzbekistan(swapped.lat, swapped.lng)).toBe(false);
    expect(issues(createClientSchema.safeParse({ ...client, ...swapped }))).toEqual([
      'lat:coordinates_outside_service_area',
    ]);
  });

  it('covers the whole country, not just Tashkent', () => {
    // Nukus (far north-west) and Termiz (far south) are both inside the box.
    expect(isWithinUzbekistan(42.4531, 59.6103)).toBe(true);
    expect(isWithinUzbekistan(37.2242, 67.2783)).toBe(true);
    // Almaty and Dushanbe are just outside it.
    expect(isWithinUzbekistan(43.2389, 76.8897)).toBe(false);
    expect(isWithinUzbekistan(38.5598, 68.787)).toBe(true); // Dushanbe is inside the generous box — by design
  });

  it('enforces the pair on partial updates too', () => {
    expect(issues(updateClientSchema.safeParse({ lat: 41.3 }))).toEqual([
      'lng:coordinates_require_both_lat_and_lng',
    ]);
    expect(updateClientSchema.safeParse({ ...TASHKENT }).success).toBe(true);
    expect(updateClientSchema.safeParse({ name: 'Renamed' }).success).toBe(true);
    expect(updatePickupPlaceSchema.safeParse({ ...TASHKENT }).success).toBe(true);
  });

  it('keeps the pickup-place district rule when the pair rule is layered on top', () => {
    // City region without a district must still fail — the coordinate refinement
    // wraps the existing one rather than replacing it.
    const r = createPickupPlaceSchema.safeParse({ ...place, district_code: undefined, ...TASHKENT });
    expect(issues(r)).toEqual(['district_code:district_required_for_city_region']);
  });
});
