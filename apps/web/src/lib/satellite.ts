import type { Map as MapLibreMap } from 'maplibre-gl';

/**
 * The satellite picture under our own map (owner, 03.11.2026: "like the drone
 * view, with the houses and the stadium"). ESRI World Imagery, on the free
 * ArcGIS Location Platform key the office holds; the key is referrer-locked to
 * our domain. Our vector fills (ground, parks, water, buildings) are hidden
 * while it shows — the photograph is the ground — and every line and name
 * stays on top, so it reads like a hybrid map.
 */
const SOURCE = 'sat';
const LAYER = 'sat';
const KEY = 'bigant.map.sat';
/** Lines that only clutter a photograph. */
const HIDDEN_UNDER_PHOTO = ['road-minor', 'road-minor-casing', 'road-secondary-casing', 'road-major-casing', 'road-motorway-casing', 'footway', 'rail-ties', 'tunnel', 'bridge-edge', 'aeroway'];

/**
 * Names over the photograph read like Google's (owner, 04.11.2026): white
 * letters on a soft dark edge. Our painted map gives them coloured text and a
 * white halo, which on the photograph glowed lilac and strained the eye.
 * Road numbers (white on a blue shield) keep their own look.
 */
const KEEP_OWN_LOOK = ['road-ref', 'traffic-signal'];
const PHOTO_TEXT = { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.75)', 'text-halo-width': 1.4, 'text-halo-blur': 0.6 } as const;
type TextPaint = keyof typeof PHOTO_TEXT;
const savedText = new WeakMap<MapLibreMap, Map<string, Partial<Record<TextPaint, unknown>>>>();

function toneNames(map: MapLibreMap, on: boolean): void {
  const style = map.getStyle();
  if (!style) return;
  let saved = savedText.get(map);
  if (!saved) {
    saved = new Map();
    savedText.set(map, saved);
  }
  for (const l of style.layers) {
    if (l.type !== 'symbol' || KEEP_OWN_LOOK.includes(l.id)) continue;
    if (!map.getLayoutProperty(l.id, 'text-field')) continue;
    if (on) {
      if (!saved.has(l.id)) {
        const before: Partial<Record<TextPaint, unknown>> = {};
        for (const k of Object.keys(PHOTO_TEXT) as TextPaint[]) before[k] = map.getPaintProperty(l.id, k);
        saved.set(l.id, before);
      }
      for (const k of Object.keys(PHOTO_TEXT) as TextPaint[]) map.setPaintProperty(l.id, k, PHOTO_TEXT[k]);
    } else {
      const before = saved.get(l.id);
      if (!before) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const k of Object.keys(PHOTO_TEXT) as TextPaint[]) map.setPaintProperty(l.id, k, (before[k] ?? undefined) as any);
      saved.delete(l.id);
    }
  }
}

export function satellitePreferred(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberSatellite(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* a private window forgets; the map still switches */
  }
}

export function satelliteOn(map: MapLibreMap): boolean {
  return !!map.getLayer(LAYER) && map.getLayoutProperty(LAYER, 'visibility') !== 'none';
}

/** Turns the photograph on or off under everything already on the map. */
export function applySatellite(map: MapLibreMap, esriKey: string, on: boolean): void {
  const style = map.getStyle();
  if (!style) return;
  if (!map.getSource(SOURCE)) {
    map.addSource(SOURCE, {
      type: 'raster',
      tiles: [
        `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=${encodeURIComponent(esriKey)}`,
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Imagery © Esri',
    });
  }
  if (!map.getLayer(LAYER)) {
    // Right above the background: under every fill, line and name.
    const first = style.layers.find((l) => l.type !== 'background');
    map.addLayer({ id: LAYER, type: 'raster', source: SOURCE, paint: { 'raster-opacity': 1 } }, first?.id);
  }
  map.setLayoutProperty(LAYER, 'visibility', on ? 'visible' : 'none');
  // The painted ground gives way to the photograph; lines and names stay.
  for (const l of style.layers) {
    if (l.type === 'fill' || l.type === 'fill-extrusion') {
      map.setLayoutProperty(l.id, 'visibility', on ? 'none' : 'visible');
    }
  }
  // The small white streets and the road casings drowned the picture (owner,
  // 03.11.2026): under the photograph they go, and the main roads thin to a
  // translucent trace — the photograph itself shows where the streets are.
  for (const id of HIDDEN_UNDER_PHOTO) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'none' : 'visible');
  }
  for (const id of ['road-secondary', 'road-major', 'road-motorway']) {
    if (map.getLayer(id)) map.setPaintProperty(id, 'line-opacity', on ? 0.45 : 1);
  }
  toneNames(map, on);
  rememberSatellite(on);
}
