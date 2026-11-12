/**
 * Google Maps, loaded once per page with the key the server hands out.
 *
 * Google bills a "map load" each time a map is created, not for panning,
 * zooming or the markers redrawn on it (owner chose Google, 30.10.2026, within
 * its free monthly loads) — so callers keep one map alive rather than
 * re-creating it on every tab switch.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GoogleMaps = any;

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    google?: any;
    __bigantGmapsReady?: () => void;
    gm_authFailure?: () => void;
  }
}

let loading: Promise<GoogleMaps> | null = null;
let authFailed = false;
const authListeners = new Set<() => void>();

/** Google calls this when it refuses the key (wrong domain, billing off, quota). */
window.gm_authFailure = () => {
  authFailed = true;
  authListeners.forEach((fn) => fn());
};

export function googleAuthFailed(): boolean {
  return authFailed;
}

export function onGoogleAuthFailure(fn: () => void): () => void {
  authListeners.add(fn);
  return () => authListeners.delete(fn);
}

export function loadGoogleMaps(key: string): Promise<GoogleMaps> {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    window.__bigantGmapsReady = () => resolve(window.google.maps);
    const s = document.createElement('script');
    s.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}` +
      '&v=weekly&language=uz&region=UZ&callback=__bigantGmapsReady';
    s.async = true;
    s.onerror = () => {
      loading = null;
      reject(new Error('google_maps_load_failed'));
    };
    document.head.appendChild(s);
  });
  return loading;
}
