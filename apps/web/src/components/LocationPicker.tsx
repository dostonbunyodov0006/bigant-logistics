import { useEffect, useMemo, useRef, useState } from 'react';
import { Marker, type Map as MapLibreMap, type MapMouseEvent } from 'maplibre-gl';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  isShortMapLink,
  parseLocationInput,
  type Coordinates,
  type GeoDistrictPublic,
  type GeocodingResult,
  type ResolvedMapLink,
} from '@bigant/shared';
import { api, ApiError } from '../lib/api';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { regionView, type MapView } from '../lib/regionCentroids';
import { BaseMap } from './BaseMap';

export type LocationPickerTheme = 'light' | 'dark';

/**
 * Photon search → pin on the map → drag to the exact entrance → reverse
 * geocode fills the address. The pin is the source of truth; search is only a
 * shortcut to get close, because OSM house-number coverage here is patchy and
 * the same name can match several places.
 *
 * Degrades on purpose: if the geocoder is down, search shows a note and the
 * seller can still click the map. Coordinates never depend on Photon being up.
 */
export function LocationPicker({
  value,
  onChange,
  onAddress,
  onResolved,
  regionCode,
  districtCode = '',
  theme = 'light',
  error,
  inputId,
  showMap = true,
}: {
  value: Coordinates | null;
  onChange: (next: Coordinates | null) => void;
  /** Called with a human-readable address whenever the pin lands somewhere resolvable. */
  onAddress?: (address: string) => void;
  /** The full geocoder result for the pin — lets the form fill Viloyat/Tuman from it. */
  onResolved?: (result: GeocodingResult) => void;
  regionCode: string;
  /** When set, the map opens on this tuman rather than the whole region. */
  districtCode?: string;
  theme?: LocationPickerTheme;
  error?: string;
  inputId?: string;
  /**
   * Draw the map, or take the position from a pasted link alone.
   *
   * A client sends a seller their location over Telegram and the seller pastes
   * the link; the map underneath was something to scroll past, and on a laptop
   * it pushed the phone field off the screen. Where nobody is expected to pick
   * a point by eye — a client's door, as opposed to a yard we load from — the
   * search box and the paste are the whole control.
   */
  showMap?: boolean;
}) {
  const { t } = useTranslation();
  const c = classes(theme);

  // The view the map should open on. Follows the region until a pin exists;
  // once the user has placed something, a region change must not yank it away.
  const initialView = useMemo(
    () => (value ? { lat: value.lat, lng: value.lng, zoom: 16 } : regionView(regionCode)),
    // Only for first mount — later region changes go through <MapController>.
    [],
  );

  const [center, setCenter] = useState<MapView>(initialView);
  const [map, setMap] = useState<MapLibreMap | null>(null);

  // Where the map should sit before a pin exists: the tuman if one is chosen,
  // else the region. Regions have a static table; tumans are looked up once
  // through Photon (a `place=district` entity carries a centroid) and cached.
  const districtsQ = useQuery({
    queryKey: ['geo', 'districts', regionCode],
    queryFn: () => api.get<GeoDistrictPublic[]>(`/geo/districts?region_code=${regionCode}`),
    enabled: !!districtCode && !!regionCode,
    staleTime: Infinity,
  });
  const districtName = districtsQ.data?.find((d) => d.code === districtCode)?.name ?? null;
  const rv = regionView(regionCode);
  const districtCenterQ = useQuery({
    queryKey: ['geo', 'district-center', districtCode],
    queryFn: async (): Promise<MapView | null> => {
      const hits = await api.get<GeocodingResult[]>(
        `/geo/search?q=${encodeURIComponent(districtName!)}&limit=5&lat=${rv.lat}&lon=${rv.lng}`,
      );
      // Prefer the administrative entity; anything else (a hokimiyat, a court)
      // is still inside the tuman and good enough to open the map on.
      const best = hits.find((h) => h.osm_value === 'district') ?? hits[0];
      return best ? { lat: best.latitude, lng: best.longitude, zoom: 13 } : null;
    },
    enabled: !!districtName,
    staleTime: Infinity,
    retry: false,
  });
  const homeView: MapView = districtCode && districtCenterQ.data ? districtCenterQ.data : rv;
  const [query, setQuery] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [flyTo, setFlyTo] = useState<MapView | null>(null);
  const debounced = useDebouncedValue(query.trim(), 300);

  const searchQ = useQuery({
    queryKey: ['geo', 'search', debounced, round(center.lat, 2), round(center.lng, 2)],
    queryFn: () =>
      api.get<GeocodingResult[]>(
        `/geo/search?q=${encodeURIComponent(debounced)}&limit=6&lat=${center.lat}&lon=${center.lng}`,
      ),
    enabled: debounced.length >= 2,
    staleTime: 60_000,
    retry: false,
  });
  const searchDown = searchQ.isError && (searchQ.error as ApiError)?.status === 503;

  /**
   * A pasted position, when the box holds one.
   *
   * Clients send where they are over Telegram, and that message is a lat/lng —
   * but the seller could only read a street name off it and search for that,
   * throwing the precision away. Every Telegram client will hand out a map link
   * for the message, so pasting it drops the pin exactly where the client stood.
   * Anything else falls through to the ordinary search.
   */
  const pastedDirect = useMemo(() => parseLocationInput(query), [query]);
  // A shortened share link (yandex.ru/maps/-/…, maps.app.goo.gl/…) carries no
  // coordinates itself; the server follows it and reads the long URL.
  const shortLink = useMemo(() => (pastedDirect ? null : isShortMapLink(query) ? query.trim() : null), [pastedDirect, query]);
  const resolveQ = useQuery({
    queryKey: ['geo', 'resolve-link', shortLink],
    queryFn: () => api.get<ResolvedMapLink>(`/geo/resolve-link?url=${encodeURIComponent(shortLink!)}`),
    enabled: !!shortLink,
    retry: false,
    staleTime: 10 * 60_000,
  });
  const pasted = pastedDirect ?? (shortLink && resolveQ.data?.location ? resolveQ.data.location : null);
  const linkFailed = !!shortLink && (resolveQ.isError || (!!resolveQ.data && !resolveQ.data.location));

  const placePin = (lat: number, lng: number, fromSearch?: GeocodingResult) => {
    onChange({ lat, lng });
    if (fromSearch) {
      onAddress?.(fromSearch.label);
      onResolved?.(fromSearch);
      return;
    }
    // Reverse-geocode a clicked/dragged pin. Best effort: a failure keeps the
    // pin and simply leaves the address and selects as they were.
    if (onAddress || onResolved) {
      // Several nearest places are asked for, and the first that names a
      // tuman is taken: the single nearest is often a shop or a hotel whose
      // record has no district at all, and then the select stayed empty.
      api
        .get<GeocodingResult[]>(`/geo/reverse?lat=${lat}&lon=${lng}&limit=5`)
        .then((r) => {
          const best = r.find((x) => x.district || x.county) ?? r[0];
          if (!best) return;
          if (best.label) onAddress?.(best.label);
          onResolved?.(best);
        })
        .catch(() => undefined);
    }
  };

  // A usable pasted position is placed by itself. With no map beneath it there
  // is nothing else to do with it, and the "drop the pin here" row that had to
  // be noticed and pressed was the step sellers skipped on their way to Save —
  // leaving the region empty and the save refused for a reason they never saw.
  const autoPlaced = useRef('');
  useEffect(() => {
    if (!pasted?.usable) return;
    const key = `${pasted.lat},${pasted.lng}`;
    if (autoPlaced.current === key) return;
    autoPlaced.current = key;
    placePin(pasted.lat, pasted.lng);
    setFlyTo({ lat: pasted.lat, lng: pasted.lng, zoom: 17 });
    // The link stays in the box: it is the seller's proof that something was
    // pasted, and clearing it read as the paste having been lost.
    setListOpen(false);
  }, [pasted]);
  // The pasted position is already the pin — nothing left to offer.
  const pastedPlaced =
    !!pasted && !!value && value.lat === pasted.lat && value.lng === pasted.lng;

  const pickResult = (r: GeocodingResult) => {
    placePin(r.latitude, r.longitude, r);
    setFlyTo({ lat: r.latitude, lng: r.longitude, zoom: 16 });
    setQuery(r.label);
    setListOpen(false);
  };

  // Re-measuring inside a modal is BaseMap's job now — every map it hosts has
  // the same problem, and doing it there means it happens whether or not the
  // style ever finishes loading.

  // Held in a ref so the handlers below, bound once, always see the current one.
  const place = useRef(placePin);
  place.current = placePin;

  useEffect(() => {
    if (!map) return;
    const onClick = (e: MapMouseEvent) =>
      place.current(round(e.lngLat.lat, 6), round(e.lngLat.lng, 6));
    const onMove = () => {
      const ctr = map.getCenter();
      setCenter({ lat: ctr.lat, lng: ctr.lng, zoom: map.getZoom() });
    };
    map.on('click', onClick);
    map.on('moveend', onMove);
    return () => {
      map.off('click', onClick);
      map.off('moveend', onMove);
    };
  }, [map]);

  // Region or tuman changed (or the tuman's centre just resolved) and nothing
  // is pinned yet → move there. Once a pin exists the map is the user's.
  const lastHome = useRef<string>('');
  useEffect(() => {
    if (!map) return;
    const key = `${homeView.lat},${homeView.lng},${homeView.zoom}`;
    if (lastHome.current === key) return;
    const first = lastHome.current === '';
    lastHome.current = key;
    if (first || value) return; // the opening view is already this
    map.jumpTo({ center: [homeView.lng, homeView.lat], zoom: homeView.zoom });
  }, [map, homeView, value]);

  useEffect(() => {
    if (map && flyTo) map.flyTo({ center: [flyTo.lng, flyTo.lat], zoom: flyTo.zoom, duration: 600 });
  }, [map, flyTo]);

  // The pin. One marker, moved rather than recreated, so dragging it does not
  // fight a re-render.
  const pin = useRef<Marker | null>(null);
  useEffect(() => {
    if (!map) return;
    if (!value) {
      pin.current?.remove();
      pin.current = null;
      return;
    }
    if (!pin.current) {
      const el = document.createElement('div');
      el.style.cssText =
        'width:26px;height:26px;border-radius:50% 50% 50% 0;background:#e2630b;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);transform:rotate(-45deg)';
      const marker = new Marker({ element: el, draggable: true, anchor: 'bottom' })
        .setLngLat([value.lng, value.lat])
        .addTo(map);
      marker.on('dragend', () => {
        const p = marker.getLngLat();
        place.current(round(p.lat, 6), round(p.lng, 6));
      });
      pin.current = marker;
      return;
    }
    pin.current.setLngLat([value.lng, value.lat]);
  }, [map, value]);

  return (
    <div>
      <label className={c.label}>{t(showMap ? 'locationPicker.label' : 'locationPicker.pasteLabel')}</label>

      <div className="relative">
        <input
          id={inputId}
          className={c.input}
          placeholder={t(showMap ? 'locationPicker.searchPlaceholder' : 'locationPicker.pastePlaceholder')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setListOpen(true);
            // Link-only: the link is the location, so emptying it drops the pin.
            if (!showMap && !e.target.value.trim() && value) onChange(null);
          }}
          onFocus={() => setListOpen(true)}
          onBlur={() => setTimeout(() => setListOpen(false), 150)}
          autoComplete="off"
        />
        {shortLink && resolveQ.isLoading && (
          <div className={c.dropdown}>
            <div className={c.note}>{t('locationPicker.resolvingLink')}</div>
          </div>
        )}
        {linkFailed && (
          <div className={c.dropdown}>
            <div className={c.note}>{t('locationPicker.linkNotResolved')}</div>
          </div>
        )}
        {pasted && !pasted.usable && (
          <div className={c.dropdown}>
            <div className={c.note}>
              {t('locationPicker.pastedOutsideCountry', {
                lat: pasted.lat.toFixed(5),
                lng: pasted.lng.toFixed(5),
              })}
            </div>
          </div>
        )}
        {pasted?.usable && !pastedPlaced && (
          <div className={c.dropdown}>
            <button
              type="button"
              className={c.option}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                placePin(pasted.lat, pasted.lng);
                setFlyTo({ lat: pasted.lat, lng: pasted.lng, zoom: 17 });
                setQuery('');
                setListOpen(false);
              }}
            >
              <span className="font-semibold">{t('locationPicker.usePasted')}</span>
              <span className={`ml-2 ${c.coords}`}>
                {pasted.lat.toFixed(5)}, {pasted.lng.toFixed(5)}
              </span>
            </button>
          </div>
        )}
        {!pasted && listOpen && debounced.length >= 2 && (
          <div className={c.dropdown}>
            {searchDown ? (
              <div className={c.note}>
                {t(showMap ? 'locationPicker.searchUnavailable' : 'locationPicker.pasteHint')}
              </div>
            ) : searchQ.isLoading ? (
              <div className={c.note}>…</div>
            ) : (searchQ.data ?? []).length === 0 ? (
              <div className={c.note}>{t('locationPicker.noResults')}</div>
            ) : (
              (searchQ.data ?? []).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()} // keep focus so onBlur doesn't close first
                  onClick={() => pickResult(r)}
                  className={c.option}
                >
                  {r.label}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Nobody discovers this by themselves, and it is the whole point. */}

      {showMap && (
        <div className={`${c.mapFrame} ${error ? 'border-[#dc2626]' : ''}`}>
          <BaseMap
            center={[initialView.lng, initialView.lat]}
            zoom={initialView.zoom}
            theme={theme}
            height={256}
            onReady={setMap}
            onTeardown={() => setMap(null)}
          />
        </div>
      )}

      <div className="mt-1.5 flex items-center justify-between gap-3">
        <span className={c.coords}>
          {value
            ? showMap
              ? `${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}`
              : t('locationPicker.pinned', { lat: value.lat.toFixed(5), lng: value.lng.toFixed(5) })
            : showMap
              ? t('locationPicker.hint')
              : ''}
        </span>
        {value && (
          <button type="button" className={c.clear} onClick={() => onChange(null)}>
            {t('locationPicker.clear')}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs font-medium text-[#dc2626]">
          {error}
        </p>
      )}
    </div>
  );
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function classes(theme: LocationPickerTheme) {
  if (theme === 'dark') {
    return {
      label: 'mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-light',
      input:
        'w-full rounded-lg border border-hairline bg-panel2 px-3 py-2.5 text-sm text-paper placeholder:text-slate outline-none focus:border-brand',
      dropdown:
        'absolute z-[1000] mt-1 max-h-56 w-full overflow-auto rounded-lg border border-hairline bg-panel shadow-2xl',
      option:
        'block w-full px-3 py-2 text-left text-sm text-paper hover:bg-panel2 border-b border-hairline last:border-0',
      note: 'px-3 py-2 text-xs text-slate',
      mapFrame: 'mt-2 overflow-hidden rounded-lg border border-hairline',
      coords: 'font-mono text-xs text-slate',
      clear: 'text-xs font-semibold text-slate-light hover:text-paper',
    };
  }
  return {
    label: 'field-label',
    input: 'input',
    dropdown:
      'absolute z-[1000] mt-1 max-h-56 w-full overflow-auto rounded-lg border border-mist bg-white shadow-lg',
    option:
      'block w-full px-3 py-2 text-left text-sm text-ink hover:bg-paper border-b border-mist last:border-0',
    note: 'px-3 py-2 text-xs text-slate',
    mapFrame: 'mt-2 overflow-hidden rounded-lg border border-mist',
    coords: 'font-mono text-xs text-slate',
    clear: 'text-xs font-semibold text-brand hover:text-brand-dark',
  };
}
