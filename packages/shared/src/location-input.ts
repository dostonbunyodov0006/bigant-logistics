import { isWithinUzbekistan } from './schemas/coordinates';

/**
 * Turns something a person pasted into a pin.
 *
 * Clients send their position to the seller over Telegram, and a Telegram
 * location message is exactly a lat/lng. Until now that was thrown away: the
 * seller opened the map, read off a street name, came back and searched for it
 * — losing the precision the client had taken the trouble to send. Every
 * Telegram client can hand out a map link for that message, so the fix is to
 * accept the link.
 *
 * Anything unrecognised returns null and the caller falls through to an
 * ordinary place search, so pasting is an addition rather than a mode.
 *
 * "Unrecognised" and "recognised but not here" are different answers and the
 * caller has to tell them apart. A link to Kansas is a location — refusing it
 * without saying so leaves the person staring at a box where nothing happened,
 * unable to tell whether the format was wrong or the place was.
 */
export type LocationSource = 'coordinates' | 'google' | 'yandex' | 'apple' | 'openstreetmap' | '2gis';

export interface ParsedLocation {
  lat: number;
  lng: number;
  source: LocationSource;
  /** False when the pair is real but lies outside the country. */
  usable: boolean;
}

/** A signed decimal degree, with the comma decimal separator people also type. */
const NUM = String.raw`[-+]?\d{1,3}(?:[.,]\d+)?`;

function num(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * A pair that parsed, flagged with whether it can actually be used.
 *
 * The country check is the guard that matters. Yandex writes longitude first
 * and everyone else writes latitude first, so a mis-read pair is not a small
 * error — it puts the pin in China. Uzbekistan's longitudes (55.9–73.2) and
 * latitudes (37.0–45.7) barely overlap, so the check catches a swap almost
 * every time.
 *
 * It returns the rejected pair rather than null so the caller can say *why*.
 */
function read(lat: number | null, lng: number | null, source: LocationSource): ParsedLocation | null {
  if (lat === null || lng === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, source, usable: isWithinUzbekistan(lat, lng) };
}

/**
 * A shortened share link, which carries no coordinates until it is followed:
 * yandex.ru/maps/-/CHxyz, maps.app.goo.gl/xyz, goo.gl/maps/xyz, go.2gis.com/xyz.
 * The server follows it (GET /geo/resolve-link) and the long URL is parsed.
 */
export function isShortMapLink(input: string): boolean {
  const url = asUrl(input.trim());
  if (!url) return false;
  const { host, path } = url;
  if (host.includes('yandex.') && /^\/maps\/-\//.test(path)) return true;
  if (host === 'maps.app.goo.gl' || host === 'goo.gl') return true;
  // Apple's share link (iOS 18+): maps.apple/p/<id>, no coordinates until followed.
  if (host === 'maps.apple' && /^\/p\//.test(path)) return true;
  if (host === 'go.2gis.com' || host === '2gis.uz' && /^\/[A-Za-z0-9]{4,}$/.test(path)) return true;
  if (host.includes('yandex.') && /^\/profile\//.test(path)) return false;
  return false;
}

/** The link as the server fetches it: https, and only the hosts a share link lives on. */
export function shortMapLinkUrl(input: string): string | null {
  if (!isShortMapLink(input)) return null;
  const text = input.trim();
  return /^https?:\/\//i.test(text) ? text.replace(/^http:/i, 'https:') : `https://${text}`;
}

export function parseLocationInput(input: string): ParsedLocation | null {
  const text = input.trim();
  if (!text) return null;

  // A link is read by host, never by guessing which number comes first.
  const url = asUrl(text);
  if (url) return fromUrl(url);

  // Bare "41.311081, 69.240562" — what you get from copying a coordinate
  // readout. Separator may be a comma, a semicolon or just spaces.
  const pair = new RegExp(`^(${NUM})\\s*[;,]?\\s+(${NUM})$|^(${NUM})\\s*,\\s*(${NUM})$`).exec(text);
  if (pair) {
    const a = num(pair[1] ?? pair[3]);
    const b = num(pair[2] ?? pair[4]);
    return read(a, b, 'coordinates');
  }
  // Degrees, minutes, seconds typed or pasted as text: what Google shows
  // under a dropped pin, copied without its link.
  const dms = dmsIn(text);
  if (dms) return read(dms[0], dms[1], 'coordinates');
  return null;
}

/**
 * The parts of a URL this needs, without the `URL` constructor.
 *
 * `shared` is compiled against ES2022 alone — no DOM, no Node types — because
 * it is consumed by the API, the dashboard and the phone app alike, and a
 * platform global here breaks whichever of them the type checker is not looking
 * at. The shapes below are simple enough not to need a real parser.
 */
interface UrlParts {
  host: string;
  path: string;
  query: string;
  hash: string;
}

function asUrl(text: string): UrlParts | null {
  const m = /^(?:https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,})(\/[^?#\s]*)?(?:\?([^#\s]*))?(?:#(\S*))?$/i.exec(text);
  if (!m) return null;
  return {
    host: (m[1] ?? '').toLowerCase().replace(/^www\./, ''),
    path: m[2] ?? '',
    query: m[3] ?? '',
    hash: m[4] ?? '',
  };
}

/** One query parameter, percent-decoded. `%2C` is how a comma arrives. */
function param(query: string, name: string): string | null {
  for (const part of query.split('&')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (decodeSafe(part.slice(0, eq)) !== name) continue;
    return decodeSafe(part.slice(eq + 1));
  }
  return null;
}

function decodeSafe(v: string): string {
  try {
    return decodeURIComponent(v.replace(/\+/g, ' '));
  } catch {
    return v;
  }
}

function fromUrl(url: UrlParts): ParsedLocation | null {
  const { host, path, query, hash } = url;

  // Yandex: ll=<lon>,<lat> — longitude first, unlike everyone else. A shared
  // point also carries pt=<lon>,<lat>, which is the pin rather than the map's
  // centre, so it wins when present.
  if (host.includes('yandex.')) {
    const pt = param(query, 'pt') ?? param(query, 'whatshere[point]');
    const ll = (pt ? pt.split('~')[0] : null) ?? param(query, 'll');
    if (ll) {
      const [lon, lat] = ll.split(',');
      return read(num(lat), num(lon), 'yandex');
    }
    return null;
  }

  if (host.includes('google.') || host.includes('goo.gl')) {
    // ?q=41.31,69.24 and ?query= are the share forms; @41.31,69.24,17z is the
    // map's own centre, which is what the address bar holds.
    const qv = param(query, 'q') ?? param(query, 'query') ?? param(query, 'daddr');
    const fromQ = qv ? pairIn(qv) : null;
    if (fromQ) return read(fromQ[0], fromQ[1], 'google');
    // A followed short link lands on /maps/place/…/data=!3m1!…!3d41.31!4d69.24:
    // the place's own pin, more exact than the @centre before it.
    const pin = new RegExp(`!3d(${NUM})!4d(${NUM})`).exec(path);
    if (pin) return read(num(pin[1]), num(pin[2]), 'google');
    // A long press on the map is shared as degrees-minutes-seconds:
    // /maps/place/41°18'39.9"N+69°14'24.4"E/@41.31,69.24,17z — the DMS is the
    // pin, the @ after it only the map's centre, so it is read first.
    const dms = dmsIn(decodeSafe(path));
    if (dms) return read(dms[0], dms[1], 'google');
    const at = new RegExp(`@(${NUM}),(${NUM})`).exec(path);
    if (at) return read(num(at[1]), num(at[2]), 'google');
    // The Google Maps app shares a dropped pin as /maps/place/41.31,69.24 or
    // /maps/search/41.31,+69.24 — the pair in the path, no @ and no data=.
    // (decodeSafe turns the + into a space, so either is allowed after the comma.)
    const inPath = new RegExp(`/maps/(?:place|search|dir/+)/?(${NUM}),[\\s+]*(${NUM})(?:[/?]|$)`).exec(
      decodeSafe(path),
    );
    if (inPath) return read(num(inPath[1]), num(inPath[2]), 'google');
    const ll = param(query, 'll') ?? param(query, 'center');
    const fromLl = ll ? pairIn(ll) : null;
    if (fromLl) return read(fromLl[0], fromLl[1], 'google');
    // A shortened link carries nothing until it is followed; say so by
    // returning null rather than pretending.
    return null;
  }

  if (host.includes('apple.com') || host === 'maps.apple') {
    // ?ll= from the classic link, ?coordinate= from the followed share link.
    const ll =
      param(query, 'coordinate') ?? param(query, 'll') ?? param(query, 'sll') ?? param(query, 'q');
    const p = ll ? pairIn(ll) : null;
    return p ? read(p[0], p[1], 'apple') : null;
  }

  if (host.includes('openstreetmap.org')) {
    // #map=17/41.31/69.24, and mlat/mlon for a marker.
    const mlat = num(param(query, 'mlat') ?? undefined);
    const mlon = num(param(query, 'mlon') ?? undefined);
    if (mlat !== null && mlon !== null) return read(mlat, mlon, 'openstreetmap');
    const m = new RegExp(`map=\\d+(?:\\.\\d+)?/(${NUM})/(${NUM})`).exec(hash);
    return m ? read(num(m[1]), num(m[2]), 'openstreetmap') : null;
  }

  if (host.includes('2gis.')) {
    // 2GIS also writes longitude first.
    const m = new RegExp(`(${NUM}),(${NUM})`).exec(path + query);
    return m ? read(num(m[2]), num(m[1]), '2gis') : null;
  }

  return null;
}

/** 41°18'39.9"N 69°14'24.4"E → decimal degrees; null when not present. */
function dmsIn(value: string): [number, number] | null {
  const one = String.raw`(\d{1,3})°\s*(\d{1,2})['′]\s*(\d{1,2}(?:\.\d+)?)["″]?\s*([NSEW])`;
  const m = new RegExp(`${one}[\\s+,]*${one}`).exec(value);
  if (!m) return null;
  const toDeg = (d: string, mnt: string, sec: string, hemi: string) => {
    const v = Number(d) + Number(mnt) / 60 + Number(sec) / 3600;
    return hemi === 'S' || hemi === 'W' ? -v : v;
  };
  const a = toDeg(m[1]!, m[2]!, m[3]!, m[4]!);
  const b = toDeg(m[5]!, m[6]!, m[7]!, m[8]!);
  const aIsLat = m[4] === 'N' || m[4] === 'S';
  return aIsLat ? [a, b] : [b, a];
}

/** First "a,b" inside a string, e.g. the value of ?q=. */
function pairIn(value: string): [number | null, number | null] | null {
  const m = new RegExp(`(${NUM})\\s*,\\s*(${NUM})`).exec(value);
  return m ? [num(m[1]), num(m[2])] : null;
}
