import { useEffect, useRef } from 'react';
import { Map as MapLibreMap, NavigationControl, addProtocol, config } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import 'maplibre-gl/dist/maplibre-gl.css';
// `?worker&url` makes Vite bundle the worker *with its dependencies* and hand
// back the emitted path. Plain `?url` copies the file verbatim, which is not
// enough: maplibre's worker is a 19 KB entry that imports a 514 KB shared
// chunk, and that import would 404 on its own.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { basemapStyle } from '../lib/mapStyle';

/**
 * MapLibre works out where its worker lives from `import.meta.url` — its own
 * module's address. After bundling that is the chunk maplibre was rolled into,
 * so it asks for `/assets/maplibre-gl-worker.mjs`, a sibling file that no
 * longer exists: the worker source went into the bundle and was never emitted
 * on its own. The request 404s, no worker starts, and the map draws nothing
 * while reporting no error of its own.
 *
 * Pointing WORKER_URL at the asset Vite emits is the whole fix. The bundle is
 * self-contained and already strict, so it loads either as the module worker
 * maplibre asks for or as the classic worker it falls back to.
 */
config.WORKER_URL = workerUrl;

/**
 * The PMTiles protocol has to be registered on the maplibre singleton before
 * any map asks for a `pmtiles://` source, and only once per page. Doing it at
 * module scope rather than in an effect keeps it ahead of the first map's
 * style load, whichever map that turns out to be.
 */
let registered = false;
function registerPmtiles() {
  if (registered) return;
  addProtocol('pmtiles', new Protocol().tile);
  registered = true;
}

export interface BaseMapProps {
  center: [number, number];
  zoom: number;
  /** The seller board is dark; the admin console is light. */
  theme?: 'light' | 'dark';
  height: number | string;
  className?: string;
  /** Called once the style has loaded, for markers and layers the caller owns. */
  onReady?: (map: MapLibreMap) => void;
  /** Called on unmount, so the caller can drop anything it attached. */
  onTeardown?: (map: MapLibreMap) => void;
  /** No + / − on the map: the caller puts its own above it. */
  noZoomButtons?: boolean;
}

/** A traffic light the style asks for by name: a dark body, red, amber and green. */
function trafficSignalIcon(): ImageData {
  const w = 20;
  const h = 44;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.roundRect(0, 0, w, h, 6);
  g.fill();
  g.fillStyle = '#3c4043';
  g.beginPath();
  g.roundRect(2, 2, w - 4, h - 4, 5);
  g.fill();
  ['#ea4335', '#fbbc04', '#34a853'].forEach((color, i) => {
    g.fillStyle = color;
    g.beginPath();
    g.arc(w / 2, 9 + i * 13, 4.5, 0, Math.PI * 2);
    g.fill();
  });
  return g.getImageData(0, 0, w, h);
}

/** Google-style round signs for the places a driver steers by. */
const POI_SIGNS: Record<string, { color: string; glyph: string }> = {
  'poi-fuel': { color: '#5e35b1', glyph: '⛽' },
  'poi-market': { color: '#1a73e8', glyph: '🛒' },
  'poi-police': { color: '#1a3d8f', glyph: '🚓' },
  'poi-metro': { color: '#c5221f', glyph: 'M' },
  'poi-bus': { color: '#1967d2', glyph: '🚌' },
  'poi-shop': { color: '#1a73e8', glyph: '🛍' },
};

function poiSign(color: string, glyph: string): ImageData {
  const size = 40;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = color;
  g.beginPath();
  g.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2);
  g.fill();
  g.font = glyph.length === 1 && /[A-Z]/.test(glyph)
    ? 'bold 22px system-ui,sans-serif'
    : '20px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(glyph, size / 2, size / 2 + 1);
  return g.getImageData(0, 0, size, size);
}

/**
 * A map, and nothing else. Callers add their own markers through `onReady` —
 * MapLibre is imperative, and wrapping every marker in a React component buys
 * re-render bugs rather than clarity.
 */
export function BaseMap({
  center,
  zoom,
  theme = 'light',
  height,
  className,
  onReady,
  onTeardown,
  noZoomButtons = false,
}: BaseMapProps) {
  const holder = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  // Held in refs so a changed callback never tears the map down and rebuilds it.
  const ready = useRef(onReady);
  const teardown = useRef(onTeardown);
  ready.current = onReady;
  teardown.current = onTeardown;

  useEffect(() => {
    if (!holder.current) return;
    registerPmtiles();
    const m = new MapLibreMap({
      container: holder.current,
      style: basemapStyle(theme),
      center,
      zoom,
      // No round (i) button over the map (owner, 04.11.2026). The credit the
      // map data and the satellite photos require stays, as a faint line of
      // small text in the corner — Esri's free key depends on it.
      attributionControl: false,
    });
    if (!noZoomButtons) m.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.current = m;
    m.on('load', () => ready.current?.(m));
    m.on('styleimagemissing', (e) => {
      if (m.hasImage(e.id)) return;
      if (e.id === 'traffic-signal') m.addImage(e.id, trafficSignalIcon(), { pixelRatio: 2 });
      const sign = POI_SIGNS[e.id];
      if (sign) m.addImage(e.id, poiSign(sign.color, sign.glyph), { pixelRatio: 2 });
    });

    // A map created inside a modal that is still animating open measures its
    // container as zero. MapLibre then has no viewport to fill, so it reads the
    // archive header and asks for no tiles at all — a blank panel with no error
    // anywhere. Re-measure once layout has settled, and on every size change
    // after that.
    //
    // This belongs here rather than in each caller: every one of them can be
    // mounted inside a modal, and the one that could not would still be
    // unharmed by a resize.
    const settle = [setTimeout(() => m.resize(), 50), setTimeout(() => m.resize(), 300)];
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(holder.current);

    return () => {
      settle.forEach(clearTimeout);
      ro.disconnect();
      const current = map.current;
      map.current = null;
      if (current) {
        teardown.current?.(current);
        current.remove();
      }
    };
    // Deliberately keyed on `theme` alone: centre and zoom are the opening view,
    // and moving the map afterwards is the user's business — a changed prop must
    // not yank it back.
  }, [theme]);

  return (
    <div className={className} style={{ height, width: '100%', position: 'relative' }}>
      <div ref={holder} style={{ height: '100%', width: '100%' }} />
      <div
        style={{
          position: 'absolute',
          right: 6,
          bottom: 3,
          fontSize: 9,
          lineHeight: 1,
          color: 'rgba(255,255,255,0.55)',
          textShadow: '0 0 2px rgba(0,0,0,0.6)',
          pointerEvents: 'none',
          zIndex: 1,
        }}
      >
        © OpenStreetMap · Esri
      </div>
    </div>
  );
}
