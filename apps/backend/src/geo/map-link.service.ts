import { Injectable, Logger } from '@nestjs/common';
import { parseLocationInput, shortMapLinkUrl, type ResolvedMapLink } from '@bigant/shared';

/**
 * Follows a shortened map share link (yandex.ru/maps/-/…, maps.app.goo.gl/…,
 * go.2gis.com/…) to the long URL that carries the coordinates, and reads
 * them. Clients send sellers these links over Telegram; the browser cannot
 * follow them itself (no CORS), so the server does.
 *
 * Only the share hosts are fetched, only over https, and redirects are
 * followed by hand so a link cannot lead this server anywhere else.
 */
@Injectable()
export class MapLinkService {
  private readonly logger = new Logger(MapLinkService.name);

  async resolve(input: string): Promise<ResolvedMapLink> {
    const start = shortMapLinkUrl(input);
    if (!start) {
      // Not a short link: whatever it is, the parser can read it directly.
      const location = parseLocationInput(input);
      return { url: null, location: location && { lat: location.lat, lng: location.lng, usable: location.usable } };
    }
    const url = await followRedirects(start, this.logger);
    const location = url ? parseLocationInput(url) : null;
    return { url, location: location && { lat: location.lat, lng: location.lng, usable: location.usable } };
  }
}

const MAX_HOPS = 6;
const ALLOWED_HOST =
  /(^|\.)(yandex\.(ru|uz|com)|ya\.ru|goo\.gl|google\.(com|ru|uz)|2gis\.(com|uz|ru)|apple\.com|maps\.apple)$/i;

/** The final URL after redirects, or null when the trail leaves the known hosts or fails. */
export async function followRedirects(start: string, logger?: Logger): Promise<string | null> {
  let url = start;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    let host: string;
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:') return null;
      host = u.hostname;
    } catch {
      return null;
    }
    if (!ALLOWED_HOST.test(host)) return null;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0 (BIGANT logistics link resolver)' },
        signal: AbortSignal.timeout(6_000),
      });
    } catch (err) {
      logger?.warn(`map link not followed (${(err as Error).message}): ${url}`);
      return null;
    }
    const next = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && next) {
      url = new URL(next, url).toString();
      continue;
    }
    // Some share pages do not redirect but carry the long URL in the page.
    if (res.ok && !parseLocationInput(url)) {
      const html = (await res.text().catch(() => '')).slice(0, 200_000);
      const inPage = /https:\/\/(?:yandex\.[a-z]+\/maps|www\.google\.com\/maps|2gis\.[a-z]+)[^"'\s<]+/.exec(html);
      if (inPage) return decodeHtml(inPage[0]);
    }
    return res.ok ? url : null;
  }
  return null;
}

const decodeHtml = (s: string) => s.replace(/&amp;/g, '&').replace(/\\u0026/g, '&');
