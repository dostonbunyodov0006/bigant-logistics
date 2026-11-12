import { Linking } from 'react-native';
import type { OrderPickupSourcePublic, OrderPublic } from '@bigant/shared';

/**
 * Turn-by-turn guidance to the next stop, in the navigator the driver has.
 * Yandex Navigator knows Tashkent's traffic and builds the route from where
 * the phone is, so it is asked first; then Yandex Maps; then Yandex's own
 * route page in the browser. Google is never offered.
 */

export interface RouteTarget {
  lat: number;
  lng: number;
  label: string;
}

const coords = (lat: number | null | undefined, lng: number | null | undefined) =>
  lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);

/** The customer's door, when the order has it pinned. */
export function clientTarget(order: OrderPublic): RouteTarget | null {
  if (!coords(order.delivery_lat, order.delivery_lng)) return null;
  return { lat: order.delivery_lat!, lng: order.delivery_lng!, label: order.client_name };
}

/** A pickup place (also where a return goes back to). */
export function stopTarget(stop: OrderPickupSourcePublic | null | undefined): RouteTarget | null {
  if (!stop || !coords(stop.lat, stop.lng)) return null;
  return { lat: stop.lat!, lng: stop.lng!, label: stop.name };
}

const STOP_LEGS = new Set([
  'depart_pickup',
  'arrive_pickup',
  'waiting_for_trip_stop',
  'return_configure',
  'return_depart',
  'return_arrive',
  'return_complete',
  'return_wait_warehouse',
]);

/** Where a return goes: the place picked for it (BIGANT sklad, do'kon, or the supplier's stop). */
export function returnTarget(stop: OrderPickupSourcePublic | null | undefined): RouteTarget | null {
  const place = stop?.return_place;
  if (place && coords(place.lat, place.lng)) return { lat: place.lat!, lng: place.lng!, label: place.name };
  return stopTarget(stop);
}

/** Where the driver is headed next, by the order's own next action. */
export function nextTargetOf(order: OrderPublic): RouteTarget | null {
  const na = order.next_action;
  if (na.type === 'none') return null;
  if (STOP_LEGS.has(na.type)) {
    const stop = order.pickup_sources.find((s) => s.id === na.pickup_id) ?? order.pickup_sources[0];
    // A return leg drives to where the goods go back to, not where they came from.
    return na.type.startsWith('return_') ? returnTarget(stop) : stopTarget(stop);
  }
  return clientTarget(order);
}

/** The apps to try, in order; each URL either opens or throws, and the next is tried. */
export function routeUrls(t: RouteTarget): string[] {
  const q = `${t.lat},${t.lng}`;
  const label = encodeURIComponent(t.label);
  const yandexNavi = `yandexnavi://build_route_on_map?lat_to=${t.lat}&lon_to=${t.lng}`;
  const yandexMaps = `yandexmaps://maps.yandex.ru/?rtext=~${q}&rtt=auto`;
  // Yandex only: the office drives by Yandex. Without the Navigator or Maps
  // app the route opens on Yandex's own site, which hands it to the Yandex
  // app if one appears later — never to Google.
  const yandexWeb = `https://yandex.uz/maps/?rtext=~${q}&rtt=auto&text=${label}`;
  return [yandexNavi, yandexMaps, yandexWeb];
}

/** Opens the route to `target`; resolves false when no app on the phone could. */
export async function openRoute(target: RouteTarget): Promise<boolean> {
  for (const url of routeUrls(target)) {
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      // Not installed or not handled — the next one is tried.
    }
  }
  return false;
}
