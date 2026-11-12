import type { ReturnDestination } from '@bigant/shared';

/**
 * Where a return actually goes, as a place the driver can be routed to
 * (owner, 30.10.2026). The seller (or the office for him) picks a kind —
 * Sklad, Do'kon or Ta'minotchi — and the driver used to be shown the stop the
 * goods came from whatever was picked. Sklad and Do'kon are BIGANT's own
 * places; Ta'minotchi is the place the goods were collected from.
 */
export interface ReturnPlace {
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  /** For the driver's call button (owner, 12.11.2026). */
  phone_number?: string | null;
  /** The supplier's place the seller picked, when there is one. */
  place_id?: string | null;
}

export type HomePlaces = Partial<Record<'warehouse' | 'store', ReturnPlace>>;

export function returnPlaceOf(
  destination: ReturnDestination | null,
  source: { name: string; lat: number | null; lng: number | null; address: string | null; phone_number?: string | null },
  home: HomePlaces,
  picked?: ReturnPlace | null,
): ReturnPlace | null {
  if (!destination) return null;
  if (destination === 'supplier') {
    // The supplier's place the seller picked from the list (owner, 12.11.2026);
    // else, as before, the place the goods came from.
    if (picked) return picked;
    return { name: source.name, address: source.address, lat: source.lat, lng: source.lng, phone_number: source.phone_number ?? null };
  }
  return home[destination] ?? null;
}

/** BIGANT's own warehouse and shop among the pickup places: by type, BIGANT's first. */
export function pickHomePlaces(
  places: { name: string; type: string; address: string | null; lat: number | null; lng: number | null; phoneNumber?: string | null }[],
): HomePlaces {
  const ours = (type: string) => {
    const all = places.filter((p) => p.type === type);
    return all.find((p) => /bigant/i.test(p.name)) ?? all[0];
  };
  const asPlace = (p: (typeof places)[number] | undefined): ReturnPlace | undefined =>
    p ? { name: p.name, address: p.address, lat: p.lat, lng: p.lng, phone_number: p.phoneNumber ?? null } : undefined;
  return { warehouse: asPlace(ours('warehouse')), store: asPlace(ours('market')) };
}
