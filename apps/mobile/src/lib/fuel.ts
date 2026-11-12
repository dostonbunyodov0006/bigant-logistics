import { Platform } from 'react-native';
import { FUEL_UNITS, type FuelType } from '@bigant/shared';
import type { TFunction } from 'i18next';

/**
 * Small pieces the fuel screens share: the fix at the shutter, the unit for a
 * fuel, number parsing that survives a comma, and opening the maps app.
 */

export interface CaptureFix {
  lat: number;
  lng: number;
  accuracy_m: number | null;
}

/** How long to wait for a GPS fix before letting the photo go without one. */
const FIX_TIMEOUT_MS = 8_000;

/**
 * The phone's position, or null when it cannot give one in time. Null is a
 * legitimate answer: the server files the log as unverified rather than
 * refusing it, so the driver is never stuck on a screen because of GPS.
 */
export async function captureFix(): Promise<CaptureFix | null> {
  if (Platform.OS === 'web') return null;
  // The whole thing is bounded, not only the GPS read: a permission prompt
  // or a location service that never answers left the driver watching
  // "Joylashuv aniqlanmoqda" with no end.
  return Promise.race([readFix(), new Promise<null>((resolve) => setTimeout(() => resolve(null), FIX_TIMEOUT_MS))]);
}

async function readFix(): Promise<CaptureFix | null> {
  try {
    const Location = await import('expo-location');
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return null;
    // The phone already knows where it was a moment ago — the app sends its
    // position every minute. That answer is instant; a fresh GPS fix under a
    // canopy at a pump can take half a minute.
    const last = await Location.getLastKnownPositionAsync({ maxAge: 3 * 60_000, requiredAccuracy: 500 }).catch(() => null);
    const pos = last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    if (!pos) return null;
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy_m: pos.coords.accuracy ?? null,
    };
  } catch {
    return null;
  }
}

/** Metres between two points on the ground — close enough over a city. */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function fuelLabel(t: TFunction, fuel: FuelType): string {
  return t(`fuel.${fuel}`);
}

export function unitLabel(t: TFunction, fuel: FuelType): string {
  return FUEL_UNITS[fuel] === 'nm3' ? t('fuel.unitNm3') : t('fuel.unitL');
}

/** "75 527,2" and "75527.2" both read as 75527.2; anything else is null. */
export function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, '').replace(',', '.');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Thousands spaced, up to three decimals, no trailing zeros. */
/** As the pump shows it: the quantity to three places (12.120), so'm to one
 *  (5600.0, 67872.0). Trailing zeros kept — the driver compares digit by digit. */
export function pumpQty(n: number): string {
  return n.toFixed(3);
}
export function pumpSum(n: number): string {
  // Thousands apart, as money is read: 294 364.0, not 294364.0.
  const [int, frac] = n.toFixed(1).split('.');
  return `${int!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${frac}`;
}

export function formatNumber(n: number): string {
  const [int, frac] = n.toFixed(3).replace(/\.?0+$/, '').split('.');
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return frac ? `${grouped}.${frac}` : grouped;
}

/** Metres as the driver reads them: "40 m" close up, "2.1 km" further out. */
export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}
