import { useCallback, useEffect, useRef } from 'react';
import { Marker, type Map as MapLibreMap } from 'maplibre-gl';
import { useTranslation } from 'react-i18next';
import { BaseMap } from './BaseMap';

export type GeoPoint = { lat: number; lng: number };

/**
 * Where the truck was: the place's fence, the photo's fix and the tracker's
 * last point on one map. Shared by the fuel log and the service visit — the
 * question is the same on both.
 */
export function FenceMap({ pin, capture, tracked, radiusM }: { pin: GeoPoint | null; capture: GeoPoint | null; tracked: GeoPoint | null; radiusM: number }) {
  const { t } = useTranslation();
  const mapRef = useRef<MapLibreMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const focus = capture ?? pin ?? tracked!;

  const draw = useCallback(
    (m: MapLibreMap) => {
      markers.current.forEach((mk) => mk.remove());
      markers.current = [];
      if (m.getLayer('fence-line')) m.removeLayer('fence-line');
      if (m.getLayer('fence-fill')) m.removeLayer('fence-fill');
      if (m.getSource('fence')) m.removeSource('fence');

      if (pin) {
        m.addSource('fence', { type: 'geojson', data: circle(pin, radiusM) });
        m.addLayer({ id: 'fence-fill', type: 'fill', source: 'fence', paint: { 'fill-color': '#e2630b', 'fill-opacity': 0.1 } });
        m.addLayer({ id: 'fence-line', type: 'line', source: 'fence', paint: { 'line-color': '#e2630b', 'line-width': 2, 'line-dasharray': [2, 2] } });
        markers.current.push(new Marker({ color: '#e2630b' }).setLngLat([pin.lng, pin.lat]).addTo(m));
      }
      if (capture) markers.current.push(new Marker({ element: dot('#15803d') }).setLngLat([capture.lng, capture.lat]).addTo(m));
      if (tracked) markers.current.push(new Marker({ element: dot('#2563eb') }).setLngLat([tracked.lng, tracked.lat]).addTo(m));

      const pts = [pin, capture, tracked].filter((p): p is GeoPoint => !!p);
      if (pts.length > 1) {
        const lats = pts.map((p) => p.lat);
        const lngs = pts.map((p) => p.lng);
        m.fitBounds(
          [
            [Math.min(...lngs), Math.min(...lats)],
            [Math.max(...lngs), Math.max(...lats)],
          ],
          { padding: 60, maxZoom: 17, duration: 0 },
        );
      }
    },
    [pin, capture, tracked, radiusM],
  );

  useEffect(() => {
    if (mapRef.current) draw(mapRef.current);
  }, [draw]);

  return (
    <div>
      <div className="overflow-hidden rounded-lg border border-mist">
        <BaseMap
          center={[focus.lng, focus.lat]}
          zoom={16}
          height={300}
          onReady={(m) => {
            mapRef.current = m;
            draw(m);
          }}
          onTeardown={() => {
            markers.current = [];
            mapRef.current = null;
          }}
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate">
        <Legend color="#15803d">{t('fuel.detail.legendPhoto')}</Legend>
        <Legend color="#2563eb">{t('fuel.detail.legendTracker')}</Legend>
        <Legend color="#e2630b" dashed>{t('fuel.detail.legendFence', { m: radiusM })}</Legend>
      </div>
    </div>
  );
}

function Legend({ color, dashed, children }: { color: string; dashed?: boolean; children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-3 w-3 rounded-full"
        style={dashed ? { border: `2px dashed ${color}` } : { background: color }}
      />
      {children}
    </span>
  );
}

type CirclePolygon = {
  type: 'Feature';
  properties: Record<string, never>;
  geometry: { type: 'Polygon'; coordinates: [number, number][][] };
};

function circle(c: { lat: number; lng: number }, radiusM: number): CirclePolygon {
  const pts: [number, number][] = [];
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((c.lat * Math.PI) / 180));
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    pts.push([c.lng + dLng * Math.cos(a), c.lat + dLat * Math.sin(a)]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [pts] } };
}

function dot(color: string): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = `width:14px;height:14px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 0 0 1px ${color}`;
  return el;
}
