import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LngLatBounds, Marker, type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type {
  DriverLocationPublic,
  DriverMapTrip,
  DriverStatus,
  GeocodingResult,
  MapNearestResult,
  MapRouteResult,
  PickupPlacePublic,
} from '@bigant/shared';
import { api } from '../lib/api';
import { BaseMap } from './BaseMap';
import { Spinner } from './ui';
import { TZ, tkYmd } from '../lib/tashkent';
import { googleAuthFailed, loadGoogleMaps, onGoogleAuthFailure } from '../lib/googleMaps';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { applySatellite, satelliteOn, satellitePreferred } from '../lib/satellite';
import { useAuth } from '../auth/AuthContext';

// Two colours only (owner, 30.10.2026): green — free to take work; red —
// busy, delivering, or off shift.
const STATUS_COLORS: Record<DriverStatus, string> = {
  available: '#16a34a',
  busy: '#dc2626',
  on_delivery: '#dc2626',
  offline: '#dc2626',
};

const TASHKENT: [number, number] = [69.2401, 41.2995];
/** Numbered stop pins: pickups amber, the client red, a return purple. */
const STOP_COLOR = { pickup: '#f29900', client: '#d93025', return: '#7b1fa2' } as const;
const MAP_HEIGHT = 600;

type Located = DriverLocationPublic & { lat: number; lng: number };

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** "01A000AA Gazel Ali": plate, the model's first word, his first name. */
function labelOf(d: DriverLocationPublic): string {
  const plate = (d.vehicle_plate ?? '').replace(/\s+/g, '');
  const model = (d.vehicle_model ?? '').split(/\s+/)[0] ?? '';
  // Names are kept surname first ("Ergashev Ali"); the last word is what he is called.
  const first = d.name.trim().split(/\s+/).pop() ?? d.name;
  return [plate, model, first].filter(Boolean).join(' ');
}

/** Gazel and Isuzu are drawn as lorries; Damas, Labo and the rest as cars. */
const isTruck = (model: string | null) => /gazel|isuzu|газел|исузу/i.test(model ?? '');

/**
 * Seen from above, nose to the right, in the status colour. The front is
 * unmistakable — windscreen and yellow headlights ahead, red lamps behind —
 * so a lorry turned to its heading reads which way it is going.
 */
function vehicleSvg(color: string, truck: boolean): string {
  const shade = 'rgba(0,0,0,.35)';
  const glass = '#1f2937';
  const head = '#fde047';
  const tail = '#ef4444';
  if (truck) {
    // Cargo box behind, the cab in front with its windscreen and lamps.
    return (
      `<svg width="28" height="13" viewBox="0 0 42 20" style="display:block">` +
      `<rect x="5" y="0" width="6" height="3" rx="1" fill="#111"/><rect x="5" y="17" width="6" height="3" rx="1" fill="#111"/>` +
      `<rect x="31" y="0" width="6" height="3" rx="1" fill="#111"/><rect x="31" y="17" width="6" height="3" rx="1" fill="#111"/>` +
      `<rect x="1" y="2" width="27" height="16" rx="1.5" fill="${color}" stroke="${shade}" stroke-width="1"/>` +
      `<line x1="5" y1="10" x2="24" y2="10" stroke="${shade}" stroke-width="1"/>` +
      `<rect x="0.5" y="3" width="2" height="3" rx=".6" fill="${tail}"/><rect x="0.5" y="14" width="2" height="3" rx=".6" fill="${tail}"/>` +
      `<path d="M29 3 H37 Q41 3 41 7 V13 Q41 17 37 17 H29 Z" fill="${color}" stroke="${shade}" stroke-width="1"/>` +
      `<path d="M34 4.5 L38.5 6 V14 L34 15.5 Z" fill="${glass}" fill-opacity=".85"/>` +
      `<rect x="39" y="3" width="2.6" height="3.6" rx=".8" fill="${head}" stroke="#a16207" stroke-width=".4"/><rect x="39" y="13.4" width="2.6" height="3.6" rx=".8" fill="${head}" stroke="#a16207" stroke-width=".4"/>` +
      `<path d="M8 6.5 L19 6.5 L19 3.8 L26 10 L19 16.2 L19 13.5 L8 13.5 Z" fill="#fff" fill-opacity=".95" stroke="rgba(0,0,0,.25)" stroke-width=".6"/>` +
      `</svg>`
    );
  }
  return (
    `<svg width="24" height="13" viewBox="0 0 36 20" style="display:block">` +
    `<rect x="6" y="0" width="6" height="3" rx="1" fill="#111"/><rect x="6" y="17" width="6" height="3" rx="1" fill="#111"/>` +
    `<rect x="24" y="0" width="6" height="3" rx="1" fill="#111"/><rect x="24" y="17" width="6" height="3" rx="1" fill="#111"/>` +
    // Body: square-ish at the back, rounded at the nose.
    `<path d="M2 3 H27 Q35 3 35 10 Q35 17 27 17 H2 Q1 17 1 16 V4 Q1 3 2 3 Z" fill="${color}" stroke="${shade}" stroke-width="1"/>` +
    // Windscreen ahead, the roof, the small rear window.
    `<path d="M23 4.5 L28.5 6 V14 L23 15.5 Z" fill="${glass}" fill-opacity=".85"/>` +
    `<rect x="5" y="5" width="3.5" height="10" rx="1.2" fill="${glass}" fill-opacity=".6"/>` +
    `<rect x="31.5" y="3.6" width="3" height="3.6" rx="1" fill="${head}" stroke="#a16207" stroke-width=".4"/><rect x="31.5" y="12.8" width="3" height="3.6" rx="1" fill="${head}" stroke="#a16207" stroke-width=".4"/>` +
    `<path d="M11.5 7.5 L17 7.5 L17 5.2 L21.5 10 L17 14.8 L17 12.5 L11.5 12.5 Z" fill="#fff" fill-opacity=".95" stroke="rgba(0,0,0,.25)" stroke-width=".6"/>` +
    `<rect x="0.6" y="4" width="2" height="3" rx=".6" fill="${tail}"/><rect x="0.6" y="13" width="2" height="3" rx=".6" fill="${tail}"/>` +
    `</svg>`
  );
}

/**
 * The vehicle in its status colour, its nose turned the way it is driving,
 * with the plate and under it the model always beside it — the way the GPS
 * trackers the office knows draw them (owner, 30.10.2026). The element is a
 * square the size of the vehicle, so centring it centres the vehicle whatever
 * way it is turned; the label hangs outside it and never turns.
 */
/** BIGANT's own place: an orange pin with its name always shown, above everything else. */
function homeEl(label: string): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = 'display:flex;flex-direction:column;align-items:center;pointer-events:none;z-index:5';
  const tag = document.createElement('div');
  tag.textContent = label;
  tag.style.cssText =
    'background:#e2630b;color:#fff;font:700 10px/1.2 system-ui,sans-serif;padding:2px 6px;border-radius:5px;' +
    'white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.35);border:1px solid #fff';
  const stem = document.createElement('div');
  stem.style.cssText = 'width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid #e2630b;margin-top:-1px';
  const dot = document.createElement('div');
  dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#e2630b;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);margin-top:1px';
  el.append(tag, stem, dot);
  return el;
}

function vehicleEl(d: DriverLocationPublic): HTMLElement {
  const color = STATUS_COLORS[d.current_status] ?? STATUS_COLORS.offline;
  const truck = isTruck(d.vehicle_model);
  // Small, and the same size whatever the zoom (owner, 04.11.2026).
  const w = truck ? 28 : 24;
  // The outer element is the map's to place: MapLibre positions it absolutely
  // and moves it with a transform. Giving it a position of its own (it once had
  // `relative`) took it out of that and the lorry slid off its spot on zoom
  // (owner, 30.10.2026). The layout lives on an inner box instead.
  const el = document.createElement('div');
  el.style.cssText = `width:${w}px;height:${w}px;cursor:pointer`;
  // The drawing faces east (90°); turn it to the heading. Standing: as drawn.
  const turn = d.heading == null ? 0 : d.heading - 90;
  const plate = (d.vehicle_plate ?? '').replace(/\s+/g, '') || d.name;
  const model = (d.vehicle_model ?? '').split(/\s+/)[0] ?? '';
  el.innerHTML =
    `<div style="position:relative;width:100%;height:100%">` +
    `<div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(${turn}deg);` +
    `filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))">` +
    vehicleSvg(color, truck) +
    `</div>` +
    `<div style="position:absolute;left:calc(100% + 2px);top:50%;transform:translateY(-50%);white-space:nowrap;` +
    `background:#fff;color:#111;border:1px solid #111;padding:0 3px;text-align:center;font:600 9.5px/1.2 system-ui,sans-serif">` +
    `${esc(plate)}` +
    (model ? `<div style="font-weight:500;font-size:8.5px;color:#3c4043">${esc(model)}</div>` : '') +
    `</div></div>`;
  return el;
}

/** "13:42" today; "28.10 05:09" when the fix is from another day, so an old pin does not pass for a live one. */
function seenAt(iso: string): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  if (tkYmd(at) === tkYmd(new Date())) return time;
  const day = at.toLocaleDateString('ru-RU', { timeZone: TZ, day: '2-digit', month: '2-digit' });
  return `${day} ${time}`;
}

function useLocated(): Located[] {
  const { data = [] } = useQuery({
    queryKey: ['drivers', 'locations'],
    queryFn: () => api.get<DriverLocationPublic[]>('/drivers/locations'),
    // Every five seconds, as the drivers' phones report while open (owner,
    // 03.11.2026); SSE still invalidates on status changes.
    refetchInterval: 5_000,
  });
  return useMemo(() => data.filter((d): d is Located => d.lat !== null && d.lng !== null), [data]);
}

/** The road drawn on our own map — a lorry's way to its next stops, or a searched route. */
function setRouteLine(m: MapLibreMap, coords: [number, number][]) {
  const src = m.getSource('route') as GeoJSONSource | undefined;
  src?.setData({
    type: 'FeatureCollection',
    features: coords.length
      ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }]
      : [],
  });
}

const km = (n: number) => `${n.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} km`;
const minutes = (s: number) => Math.max(1, Math.round(s / 60));

/** Where the pressed lorry is going: the next stop with its km and minutes, then the whole run. */
function useTripHtml(): (trip: DriverMapTrip | null) => string {
  const { t } = useTranslation();
  return useCallback(
    (trip: DriverMapTrip | null) => {
      const w = trip?.trip;
      if (!w)
        return `<div style="margin-top:6px;font-size:12px;color:#5f6368">${esc(t(trip?.busy_elsewhere ? 'map.busyElsewhere' : 'map.noWork'))}</div>`;
      // One row per stop, numbered as its pin on the map: "1 Yuk olish: Sklad
      // — 14 daq · 6,2 km", then the next stop from that one, then the total.
      let pickupNo = 0;
      const rows = w.legs
        .map((l, i) => {
          const what =
            l.kind === 'pickup' ? t('map.pickupN', { n: ++pickupNo }) : l.kind === 'return' ? t('map.returnTo') : t('map.client');
          const name = l.name
            ? `<div style="font-size:12px;color:#3c4043;margin-top:1px">🎯 ${esc(l.name)}</div>`
            : '';
          const bg = STOP_COLOR[l.kind];
          return (
            `<div style="display:flex;gap:6px;align-items:flex-start;margin-top:5px">` +
            `<span style="flex:none;width:18px;height:18px;border-radius:50%;background:${bg};color:#fff;font:700 11px/18px system-ui;text-align:center">${i + 1}</span>` +
            `<div style="min-width:0"><div style="font-size:13px;color:#202124"><b>${esc(what)}:</b> ` +
            `<b style="font-size:15px;color:#1a73e8">${minutes(l.seconds)} ${esc(t('map.min'))} · ${km(l.km)}</b></div>${name}</div></div>`
          );
        })
        .join('');
      const total =
        w.legs.length > 1
          ? `<div style="margin-top:6px;padding-top:5px;border-top:1px solid #eee;font-size:13px"><b>${esc(t('map.total'))}:</b> ` +
            `<b style="color:#1a73e8">${minutes(w.total_seconds)} ${esc(t('map.min'))} · ${km(w.total_km)}</b></div>`
          : '';
      return `<div style="margin-top:6px;padding-top:4px;border-top:1px solid #eee;color:#202124">${rows}</div>${total}`;
    },
    [t],
  );
}

/**
 * Moving, slow, or standing and for how long (owner, 02.11.2026). Said only for
 * a fix from the last five minutes: an old one does not know what he is doing.
 */
function motionLine(d: Located, t: TFunction): string {
  if (!d.location_updated_at) return '';
  const line = (text: string, color: string) =>
    `<div style="margin-top:4px;font-size:13px;font-weight:700;color:${color}">${esc(text)}</div>`;
  if (Date.now() - new Date(d.location_updated_at).getTime() > 5 * 60_000) {
    return line(t('map.noSignal'), '#5f6368');
  }
  if (d.speed_kmh == null) return '';
  if (d.speed_kmh >= 15) return line(t('map.moving', { v: d.speed_kmh }), '#188038');
  const stood = d.moved_at ? Math.floor((Date.now() - new Date(d.moved_at).getTime()) / 60_000) : 0;
  if (d.speed_kmh < 5 && stood >= 2) {
    const h = Math.floor(stood / 60);
    return line(
      h > 0 ? t('map.standingLong', { h, m: stood % 60 }) : t('map.standing', { m: stood }),
      '#d93025',
    );
  }
  return line(t('map.slow', { v: d.speed_kmh }), '#e37400');
}

function usePopupHtml(): (d: Located, here?: string | null) => string {
  const { t } = useTranslation();
  return useCallback(
    (d: Located, here?: string | null) => {
      const motion = motionLine(d, t);
      // Which street, district and region he is in, as the address service names it.
      const where = here ? `<div style="margin-top:4px;font-size:12px;color:#202124">📍 ${esc(here)}</div>` : '';
      const seen = d.location_updated_at
        ? `<div style="margin-top:4px;font-size:11px;color:#8a93a0">${t('drivers.lastSeen')}: ${seenAt(d.location_updated_at)}</div>`
        : '';
      // Standing inside a station's fence right now: said on the pin, so
      // the office can see a fill happening rather than read about it after.
      const atStation = d.at_fuel_station
        ? `<div style="margin-top:4px;font-size:11px;font-weight:700;color:#b94e06">${esc(t('drivers.atFuelStation', { station: d.at_fuel_station }))}</div>`
        : '';
      const lorryLine = d.vehicle_plate
        ? `<div style="font-size:12px;color:#5b6470">${esc(d.vehicle_plate)}${d.vehicle_model ? ` · ${esc(d.vehicle_model)}` : ''}</div>`
        : '';
      return `<div style="min-width:120px;color:#111"><strong>${esc(d.name)}</strong>${lorryLine}${where}${motion}${atStation}${seen}</div>`;
    },
    [t],
  );
}

/** Google's map when the server has a key for it and Google accepts it; our own tiles otherwise. */
export function DriversMap() {
  const mapQ = useQuery({
    queryKey: ['settings', 'map'],
    queryFn: () => api.get<{ google_maps_key: string | null; esri_key: string | null }>('/settings/map'),
    staleTime: Infinity,
  });
  const [refused, setRefused] = useState(googleAuthFailed);
  const refuse = useCallback(() => setRefused(true), []);
  useEffect(() => onGoogleAuthFailure(refuse), [refuse]);

  if (mapQ.isLoading) return <Spinner />;
  const key = mapQ.data?.google_maps_key;
  return key && !refused ? <GoogleDriversMap apiKey={key} onFail={refuse} /> : <OwnDriversMap esriKey={mapQ.data?.esri_key ?? null} />;
}

function GoogleDriversMap({ apiKey, onFail }: { apiKey: string; onFail: () => void }) {
  const located = useLocated();
  const popupHtml = usePopupHtml();
  const tripHtml = useTripHtml();
  const box = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = useRef<{ maps: any; map: any; info: any; overlays: any[]; line?: any; asked?: string } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let gone = false;
    loadGoogleMaps(apiKey)
      .then((maps) => {
        if (gone || !box.current) return;
        const map = new maps.Map(box.current, {
          center: { lat: TASHKENT[1], lng: TASHKENT[0] },
          zoom: 11,
          mapTypeControl: false,
          streetViewControl: false,
          clickableIcons: false,
        });
        // Live traffic, which only Google has: green, amber, red on the roads.
        new maps.TrafficLayer().setMap(map);
        g.current = { maps, map, info: new maps.InfoWindow(), overlays: [] };
        setReady(true);
      })
      .catch(onFail);
    return () => {
      gone = true;
      g.current?.overlays.forEach((o) => o.setMap(null));
      g.current = null;
    };
  }, [apiKey, onFail]);

  // Markers are replaced wholesale on every refresh. With a fleet this size
  // that is cheaper than diffing, and it cannot leave a stale pin behind.
  // Redrawing them is not a new map load: Google bills creating the map only.
  useEffect(() => {
    const cur = g.current;
    if (!ready || !cur) return;
    const { maps, map, info } = cur;
    cur.overlays.forEach((o) => o.setMap(null));
    cur.overlays = located.map((d) => {
      const pos = new maps.LatLng(d.lat, d.lng);
      const el = vehicleEl(d);
      el.style.position = 'absolute';
      el.style.transform = 'translate(-50%, -50%)';
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        info.setContent(popupHtml(d) + '<div style="margin-top:6px;color:#8a93a0">…</div>');
        info.setPosition(pos);
        info.open({ map });
        cur.line?.setMap(null);
        const asked = d.id;
        cur.asked = asked;
        void api
          .get<DriverMapTrip>(`/drivers/${d.id}/map-trip`)
          .catch(() => null)
          .then((trip) => {
            if (cur.asked !== asked) return;
            info.setContent(popupHtml(d) + tripHtml(trip));
            const coords = trip?.trip?.coordinates ?? [];
            if (coords.length < 2) return;
            const path = coords.map(([lng, lat]) => ({ lat, lng }));
            cur.line = new maps.Polyline({ path, strokeColor: '#1a73e8', strokeWeight: 6, strokeOpacity: 0.9, map });
            const b = new maps.LatLngBounds();
            path.forEach((p) => b.extend(p));
            map.fitBounds(b, 60);
          });
      });
      // A plain HTML element pinned to a position: Google's own markers want
      // a Map ID for custom content, this needs nothing.
      const overlay = new maps.OverlayView();
      overlay.onAdd = () => overlay.getPanes().overlayMouseTarget.appendChild(el);
      overlay.draw = () => {
        const p = overlay.getProjection().fromLatLngToDivPixel(pos);
        if (p) {
          el.style.left = `${p.x}px`;
          el.style.top = `${p.y}px`;
        }
      };
      overlay.onRemove = () => el.remove();
      overlay.setMap(map);
      return overlay;
    });
  }, [ready, located, popupHtml, tripHtml]);

  return <div ref={box} style={{ height: MAP_HEIGHT, borderRadius: 12, overflow: 'hidden' }} />;
}

/**
 * Ten made-up lorries, one per Tashkent district, each sent to a stop in
 * another — so the office can try the map before the real drivers report
 * positions (owner, 30.10.2026). Drawn on screen only: nothing is written to
 * the database, nothing reaches the seller board or payroll.
 */
type DemoStop = { at: [number, number]; name: string };
// One assigned location each (owner, 30.10.2026); a real lorry with pickups
// shows every stop the same way.
const DEMO: { at: [number, number]; pickups: DemoStop[]; client: DemoStop; model: string; status: DriverStatus }[] = [
  { at: [69.2034, 41.2756], pickups: [], client: { at: [69.287, 41.364], name: "Yunusobod tumani" }, model: 'GAZelle NEXT', status: 'on_delivery' },
  { at: [69.288, 41.366], pickups: [], client: { at: [69.221, 41.227], name: "Sergeli tumani" }, model: 'Damas Van', status: 'on_delivery' },
  { at: [69.334, 41.338], pickups: [], client: { at: [69.216, 41.353], name: "Olmazor tumani" }, model: 'Labo', status: 'on_delivery' },
  { at: [69.255, 41.29], pickups: [], client: { at: [69.34, 41.292], name: "Yashnobod tumani" }, model: 'Isuzu NPR82L', status: 'on_delivery' },
  { at: [69.22, 41.224], pickups: [], client: { at: [69.282, 41.296], name: "Mirobod tumani" }, model: 'Damas Kombi', status: 'on_delivery' },
  { at: [69.212, 41.351], pickups: [], client: { at: [69.334, 41.209], name: "Bektemir tumani" }, model: 'GAZelle Biznes', status: 'on_delivery' },
  { at: [69.228, 41.324], pickups: [], client: { at: [69.181, 41.288], name: "Uchtepa tumani" }, model: 'Labo', status: 'on_delivery' },
  { at: [69.35, 41.295], pickups: [], client: { at: [69.205, 41.27], name: "Chilonzor tumani" }, model: 'Damas Van', status: 'on_delivery' },
  { at: [69.335, 41.21], pickups: [], client: { at: [69.338, 41.335], name: "Mirzo Ulug'bek tumani" }, model: 'GAZelle NEXT', status: 'on_delivery' },
  { at: [69.179, 41.29], pickups: [], client: { at: [69.24, 41.328], name: "Shayxontohur tumani" }, model: 'Labo', status: 'on_delivery' },
];

/** Degrees clockwise from north, [lng, lat] to [lng, lat]. */
function bearing(a: [number, number], b: [number, number]): number {
  const rad = (x: number) => (x * Math.PI) / 180;
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const demoLocated = (): Located[] =>
  DEMO.map((v, i) => ({
    id: `demo-${i}`,
    name: `Test haydovchi ${i + 1}`,
    current_status: v.status,
    lat: v.at[1],
    lng: v.at[0],
    location_updated_at: new Date().toISOString(),
    speed_kmh: null,
    moved_at: null,
    vehicle_plate: `01 T ${String(i + 1).padStart(3, '0')} TT`,
    vehicle_model: v.model,
    at_fuel_station: null,
    heading: bearing(v.at, v.client.at),
  }));

/** A test lorry's trip, worked out the same way as a real one: our address service and our roads. */
async function demoTrip(d: Located): Promise<DriverMapTrip> {
  const v = DEMO[Number(d.id.slice(5))]!;
  const stops = [
    ...v.pickups.map((p) => ({ ...p, kind: 'pickup' as const })),
    { ...v.client, kind: 'client' as const },
  ];
  // Leg by leg: from him to the first stop, then from each stop to the next.
  const froms: [number, number][] = [[d.lng, d.lat], ...stops.slice(0, -1).map((s) => s.at)];
  const [here, ...roads] = await Promise.all([
    api
      .get<GeocodingResult[]>(`/geo/reverse?lat=${d.lat}&lon=${d.lng}`)
      .then(([r]) => (r ? [r.street ?? r.name, r.district ?? r.county, r.state ?? r.city].filter(Boolean).join(', ') : null))
      .catch(() => null),
    ...stops.map((s, i) =>
      api
        .get<MapRouteResult>(`/geo/route?from_lat=${froms[i]![1]}&from_lon=${froms[i]![0]}&to_lat=${s.at[1]}&to_lon=${s.at[0]}`)
        .catch(() => null),
    ),
  ]);
  if (roads.some((r) => !r)) return { here: here as string | null, trip: null };
  const legs = stops.map((s, i) => ({
    kind: s.kind,
    name: s.name,
    km: Math.round(roads[i]!.length_km * 10) / 10,
    seconds: roads[i]!.time_seconds,
    lat: s.at[1],
    lng: s.at[0],
  }));
  return {
    here: here as string | null,
    trip: {
      next_kind: legs[0]!.kind,
      next_name: legs[0]!.name,
      next_km: legs[0]!.km,
      next_seconds: legs[0]!.seconds,
      total_km: Math.round(roads.reduce((a, r) => a + r!.length_km, 0) * 10) / 10,
      total_seconds: roads.reduce((a, r) => a + r!.time_seconds, 0),
      stops: legs.length,
      legs,
      coordinates: roads.flatMap((r) => r!.coordinates),
    },
  };
}

function OwnDriversMap({ esriKey }: { esriKey: string | null }) {
  const { user } = useAuth();
  const staff = user?.role === 'admin' || user?.role === 'manager';
  // On from the start so the office sees them at once; the button hides them.
  // Off since go-live preparation (owner, 03.11.2026): the ten drawn lorries were for testing the map.
  const [demo, setDemo] = useState(false);
  const real = useLocated();
  const located = useMemo(() => (demo ? [...real, ...demoLocated()] : real), [demo, real]);
  const { t } = useTranslation();
  const popupHtml = usePopupHtml();
  const map = useRef<MapLibreMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const [mapReady, setMapReady] = useState(false);

  const tripHtml = useTripHtml();
  const [card, setCard] = useState<string | null>(null);
  const asked = useRef<string | null>(null);
  const stopPins = useRef<Marker[]>([]);
  // Closing the card takes its road and pins away with it.
  const clearTrip = useCallback(() => {
    const m = map.current;
    if (m) setRouteLine(m, []);
    stopPins.current.forEach((pin) => pin.remove());
    stopPins.current = [];
  }, []);
  const closeCard = () => {
    asked.current = null;
    setCard(null);
    clearTrip();
  };

  // A press opens what the lorry is doing — street, district, region, the road
  // to its next stop drawn on the map with the km and minutes left.
  const open = useCallback(
    async (d: Located) => {
      const m = map.current;
      if (!m) return;
      clearTrip();
      // The card sits in the map's corner, not over the lorry: a box opened on
      // the pin hid the lorry it was about (owner, 30.10.2026).
      asked.current = d.id;
      setCard(popupHtml(d) + '<div style="margin-top:6px;color:#8a93a0">…</div>');
      const trip = d.id.startsWith('demo-')
        ? await demoTrip(d)
        : await api.get<DriverMapTrip>(`/drivers/${d.id}/map-trip`).catch(() => null);
      if (asked.current !== d.id) return;
      setCard(popupHtml(d) + tripHtml(trip));
      const coords = trip?.trip?.coordinates ?? [];
      setRouteLine(m, coords);
      // Each stop numbered as in the card: pickups amber, the client red.
      stopPins.current = (trip?.trip?.legs ?? []).map((l, i) => {
        const el = document.createElement('div');
        el.style.cssText =
          `width:26px;height:26px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);` +
          `background:${STOP_COLOR[l.kind]};color:#fff;font:700 13px/22px system-ui;text-align:center`;
        el.textContent = String(i + 1);
        return new Marker({ element: el }).setLngLat([l.lng, l.lat]).addTo(m);
      });
      if (coords.length > 1) {
        const b = new LngLatBounds();
        coords.forEach((c) => b.extend(c));
        // Room on the right for the card, so the road is not under it.
        m.fitBounds(b, { padding: { top: 70, bottom: 50, left: 50, right: 320 }, maxZoom: 15 });
      }
    },
    [popupHtml, tripHtml, clearTrip],
  );

  const draw = useCallback(() => {
    const m = map.current;
    if (!m) return;
    markers.current.forEach((mk) => mk.remove());
    markers.current = located.map((d) => {
      const el = vehicleEl(d);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        void open(d);
      });
      return new Marker({ element: el }).setLngLat([d.lng, d.lat]).addTo(m);
    });
  }, [located, open]);

  // Redraw when the list changes; the first draw comes from onReady, since the
  // map has no style to hang markers on until then.
  useEffect(() => draw(), [draw]);

  // Our own shop with the office, and our warehouse, always on the map and
  // easy to spot (owner, 04.11.2026): whoever opens it knows where they are.
  const homeQ = useQuery({
    queryKey: ['pickup-places', 'home'],
    queryFn: () => api.get<PickupPlacePublic[]>('/pickup-places'),
    staleTime: 10 * 60_000,
    select: (all) => all.filter((p) => (p.type === 'market' || p.type === 'warehouse') && !p.supplier_id && p.lat != null && p.lng != null),
  });
  const homePins = useRef<Marker[]>([]);
  useEffect(() => {
    const m = map.current;
    if (!m || !mapReady) return;
    homePins.current.forEach((pin) => pin.remove());
    homePins.current = (homeQ.data ?? []).map((p) =>
      new Marker({ element: homeEl(p.type === 'market' ? t('map.homeShop') : t('map.homeWarehouse')), anchor: 'bottom' })
        .setLngLat([p.lng!, p.lat!])
        .addTo(m),
    );
    return () => {
      homePins.current.forEach((pin) => pin.remove());
      homePins.current = [];
    };
  }, [homeQ.data, mapReady, t]);

  return (
    <div>
      {/* Search, Sputnik and zoom above the map, not on it (owner, 04.11.2026). */}
      <div className="relative z-20 mb-2 flex items-start gap-2">
        {mapReady ? <MapTools map={map} located={located} /> : <div className="flex-1" />}
        {mapReady && esriKey && <SatelliteToggle map={map} esriKey={esriKey} />}
        {mapReady && <ZoomButtons map={map} />}
      </div>
    <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden' }}>
      <BaseMap
        center={TASHKENT}
        zoom={11}
        height={MAP_HEIGHT}
        noZoomButtons
        onReady={(m) => {
          map.current = m;
          // The photograph, if he had it on last time and the office has a key.
          if (esriKey && satellitePreferred()) applySatellite(m, esriKey, true);
          m.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          // Slim, and slipped in under the trees, traffic lights and every name,
          // so the street it runs along stays readable (owner, 30.10.2026).
          const under = m.getLayer('tree') ? 'tree' : undefined;
          m.addLayer(
            {
              id: 'route-casing',
              type: 'line',
              source: 'route',
              paint: {
                'line-color': '#1557b0',
                'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 14, 6, 17, 9],
                'line-opacity': 0.8,
              },
              layout: { 'line-cap': 'round', 'line-join': 'round' },
            },
            under,
          );
          m.addLayer(
            {
              id: 'route',
              type: 'line',
              source: 'route',
              paint: {
                'line-color': '#4285f4',
                'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 14, 4, 17, 6],
                'line-opacity': 0.85,
              },
              layout: { 'line-cap': 'round', 'line-join': 'round' },
            },
            under,
          );
          setMapReady(true);
          draw();
        }}
        onTeardown={() => {
          markers.current = [];
          map.current = null;
          setMapReady(false);
        }}
      />
      {card && (
        <div className="absolute bottom-3 right-3 z-10 w-[280px] max-w-[calc(100%-24px)] rounded-xl bg-white p-3 pr-8 text-[12px] shadow-lg">
          <button
            type="button"
            className="absolute right-2 top-1.5 text-base text-[#5f6368] hover:text-[#202124]"
            onClick={closeCard}
            aria-label="close"
          >
            ✕
          </button>
          {/* Every value in it is escaped where the html is built. */}
          <div dangerouslySetInnerHTML={{ __html: card }} />
        </div>
      )}
      {staff && (
        <button
          type="button"
          className={`absolute bottom-3 left-3 z-10 rounded-lg px-3 py-2 text-[13px] font-semibold shadow-md ${
            demo ? 'bg-[#1a73e8] text-white' : 'bg-white text-[#202124]'
          }`}
          onClick={() => setDemo((v) => !v)}
        >
          {t('map.demo')}
        </button>
      )}
    </div>
    </div>
  );
}

/** + and − beside the search, outside the map. */
function ZoomButtons({ map }: { map: React.MutableRefObject<MapLibreMap | null> }) {
  const btn =
    'flex h-[42px] w-[42px] items-center justify-center rounded-lg border border-mist bg-white text-xl font-semibold text-ink shadow-sm hover:bg-paper';
  return (
    <div className="flex shrink-0 gap-1.5">
      <button type="button" className={btn} aria-label="zoom out" onClick={() => map.current?.zoomOut()}>
        −
      </button>
      <button type="button" className={btn} aria-label="zoom in" onClick={() => map.current?.zoomIn()}>
        +
      </button>
    </div>
  );
}


/**
 * Google-like tools over the office map (owner, 30.10.2026): find a place, see
 * which lorries are closest to it by road, and draw the road from one of them.
 * Search is our Photon, the road is our Valhalla — nothing leaves the server.
 */
/** Sputnik / Xarita, under the zoom buttons: the photograph on or off. */
function SatelliteToggle({ map, esriKey }: { map: React.MutableRefObject<MapLibreMap | null>; esriKey: string }) {
  const { t } = useTranslation();
  const [on, setOn] = useState(() => (map.current ? satelliteOn(map.current) : satellitePreferred()));
  const flip = () => {
    const m = map.current;
    if (!m) return;
    applySatellite(m, esriKey, !on);
    setOn(!on);
  };
  return (
    <button
      type="button"
      onClick={flip}
      aria-pressed={on}
      className="h-[42px] shrink-0 rounded-lg border border-mist bg-white px-3.5 text-[13px] font-bold text-ink shadow-sm hover:bg-paper"
    >
      {on ? t('map.plain') : t('map.satellite')}
    </button>
  );
}

function MapTools({ map, located }: { map: React.MutableRefObject<MapLibreMap | null>; located: Located[] }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const debounced = useDebouncedValue(q.trim(), 300);
  const [place, setPlace] = useState<GeocodingResult | null>(null);
  const [route, setRoute] = useState<(MapRouteResult & { label: string }) | null>(null);
  const pin = useRef<Marker | null>(null);

  const results = useQuery({
    queryKey: ['map-search', debounced],
    queryFn: () =>
      api.get<GeocodingResult[]>(
        `/geo/search?q=${encodeURIComponent(debounced)}&limit=6&lat=${TASHKENT[1]}&lon=${TASHKENT[0]}`,
      ),
    enabled: debounced.length >= 2 && debounced !== place?.label,
  });

  // Up to 50 lorries measured by road to the place; the five quickest are listed.
  const nearest = useQuery({
    queryKey: ['map-nearest', place?.id, located.map((d) => `${d.id}:${d.lat}:${d.lng}`).join('|')],
    queryFn: () =>
      api.post<MapNearestResult>('/geo/nearest', {
        to: { lat: place!.latitude, lon: place!.longitude },
        from: located.slice(0, 50).map((d) => ({ lat: d.lat, lon: d.lng })),
      }),
    enabled: !!place && located.length > 0,
  });
  const ranked = (nearest.data?.legs ?? [])
    .map((leg, i) => ({ d: located[i]!, ...leg }))
    .filter((r) => r.d && r.time_seconds != null)
    .sort((a, b) => a.time_seconds! - b.time_seconds!)
    .slice(0, 5);

  const setLine = (coords: [number, number][]) => map.current && setRouteLine(map.current, coords);

  const choose = (r: GeocodingResult) => {
    setPlace(r);
    setQ(r.label);
    setRoute(null);
    setLine([]);
    const m = map.current;
    if (!m) return;
    pin.current?.remove();
    pin.current = new Marker({ color: '#ea4335' }).setLngLat([r.longitude, r.latitude]).addTo(m);
    m.flyTo({ center: [r.longitude, r.latitude], zoom: Math.max(m.getZoom(), 15) });
  };

  const clear = () => {
    setQ('');
    setPlace(null);
    setRoute(null);
    setLine([]);
    pin.current?.remove();
    pin.current = null;
  };

  const showRoute = async (d: Located) => {
    if (!place) return;
    const r = await api.get<MapRouteResult>(
      `/geo/route?from_lat=${d.lat}&from_lon=${d.lng}&to_lat=${place.latitude}&to_lon=${place.longitude}`,
    );
    setRoute({ ...r, label: labelOf(d) });
    setLine(r.coordinates);
    const b = new LngLatBounds();
    r.coordinates.forEach((c) => b.extend(c));
    if (!b.isEmpty()) map.current?.fitBounds(b, { padding: 70, maxZoom: 16 });
  };

  useEffect(() => () => void pin.current?.remove(), []);

  return (
    <div className="relative min-w-0 flex-1 text-[13px] text-[#202124]">
      <div className="flex h-[42px] items-center rounded-lg border border-mist bg-white shadow-sm">
        <input
          className="min-w-0 flex-1 rounded-lg bg-transparent px-3 py-2.5 text-ink outline-none"
          placeholder={t('map.search')}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (place && e.target.value !== place.label) setPlace(null);
          }}
        />
        {q && (
          <button type="button" className="px-3 text-lg text-[#5f6368]" onClick={clear} aria-label="clear">
            ✕
          </button>
        )}
      </div>
      {!place && (results.data?.length ?? 0) > 0 && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg bg-white shadow-md">
          {results.data!.map((r) => (
            <button
              key={r.id}
              type="button"
              className="block w-full border-b border-[#f1f3f4] px-3 py-2 text-left last:border-0 hover:bg-[#f1f3f4]"
              onClick={() => choose(r)}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
      {place && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-w-[420px] overflow-hidden rounded-lg bg-white shadow-md">
          <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-[#5f6368]">
            {t('map.nearest')}
          </div>
          {nearest.isLoading ? (
            <div className="px-3 py-2 text-[#5f6368]">…</div>
          ) : ranked.length === 0 ? (
            <div className="px-3 py-2 text-[#5f6368]">—</div>
          ) : (
            ranked.map((r) => (
              <button
                key={r.d.id}
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[#f1f3f4]"
                onClick={() => void showRoute(r.d)}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: STATUS_COLORS[r.d.current_status] }} />
                <span className="min-w-0 flex-1 truncate">{labelOf(r.d)}</span>
                <span className="shrink-0 font-semibold text-[#1a73e8]">
                  {minutes(r.time_seconds!)} {t('map.min')}
                </span>
                <span className="shrink-0 text-[#5f6368]">{km(r.length_km ?? 0)}</span>
              </button>
            ))
          )}
          {route && (
            <div className="border-t border-[#f1f3f4] px-3 py-2">
              <span className="font-semibold">{route.label}</span>:{' '}
              <span className="font-semibold text-[#1a73e8]">
                {minutes(route.time_seconds)} {t('map.min')}
              </span>{' '}
              · {km(route.length_km)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
