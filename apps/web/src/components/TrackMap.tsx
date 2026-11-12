import { useCallback, useEffect, useRef } from 'react';
import { Marker, type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl';
import type { TrackPoint } from '@bigant/shared';
import { BaseMap } from './BaseMap';

const TASHKENT: [number, number] = [69.2401, 41.2995];
const SOURCE = 'track';

/** A day's trail as a line with its start and end marked. */
export function TrackMap({ points, startLabel, endLabel }: { points: TrackPoint[]; startLabel: string; endLabel: string }) {
  const mapRef = useRef<MapLibreMap | null>(null);
  const markers = useRef<Marker[]>([]);

  const draw = useCallback(
    (m: MapLibreMap) => {
      markers.current.forEach((mk) => mk.remove());
      markers.current = [];
      const data = {
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'LineString' as const, coordinates: points.map((p) => [p.lng, p.lat]) },
      };
      const source = m.getSource(SOURCE) as GeoJSONSource | undefined;
      if (source) {
        source.setData(data);
      } else {
        m.addSource(SOURCE, { type: 'geojson', data });
        m.addLayer({
          id: `${SOURCE}-line`,
          type: 'line',
          source: SOURCE,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#e2630b', 'line-width': 4, 'line-opacity': 0.85 },
        });
      }
      if (points.length === 0) return;
      const first = points[0]!;
      const last = points[points.length - 1]!;
      markers.current.push(new Marker({ element: pin('#15803d', startLabel) }).setLngLat([first.lng, first.lat]).addTo(m));
      if (points.length > 1) {
        markers.current.push(new Marker({ element: pin('#1d4ed8', endLabel) }).setLngLat([last.lng, last.lat]).addTo(m));
      }
      const lats = points.map((p) => p.lat);
      const lngs = points.map((p) => p.lng);
      m.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        { padding: 60, maxZoom: 15, duration: 0 },
      );
    },
    [points, startLabel, endLabel],
  );

  useEffect(() => {
    if (mapRef.current) draw(mapRef.current);
  }, [draw]);

  return (
    <div className="overflow-hidden rounded-lg border border-mist">
      <BaseMap
        center={TASHKENT}
        zoom={11}
        height={520}
        onReady={(m) => {
          mapRef.current = m;
          draw(m);
        }}
        onTeardown={() => {
          mapRef.current = null;
          markers.current = [];
        }}
      />
    </div>
  );
}

function pin(color: string, label: string): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = `display:flex;align-items:center;gap:6px;padding:3px 8px 3px 4px;border-radius:999px;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.25);font:600 12px system-ui;color:#14181f`;
  const dot = document.createElement('span');
  dot.style.cssText = `width:12px;height:12px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 1px ${color}`;
  el.append(dot, document.createTextNode(label));
  return el;
}
