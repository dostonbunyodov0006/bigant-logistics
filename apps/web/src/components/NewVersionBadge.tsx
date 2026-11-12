import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Keeps the tab on the code the server is serving.
 *
 * A single-page app runs whatever it was served until something reloads it,
 * so a console left open all day went on showing the morning's version, and
 * the person in front of it concluded the fix was never made. This watches
 * the entry script named in index.html; when the server's differs from the
 * one this tab runs, the tab reloads itself.
 *
 * It reloads only when nothing would be lost: no window open over the page
 * (a seller has seven minutes to fill a form; pulling it from under him would
 * be worse than the stale button). While one is open the badge offers the
 * reload instead, and the moment the window closes the reload happens on
 * its own. The check runs every half minute and whenever the tab comes back
 * into view, so a release is on screen within a minute of landing.
 */
export function NewVersionBadge() {
  const { t } = useTranslation();
  const [stale, setStale] = useState(false);

  useEffect(() => {
    const mine = document
      .querySelector<HTMLScriptElement>('script[type="module"][src]')
      ?.getAttribute('src');
    if (!mine) return;
    let stopped = false;

    const check = async () => {
      try {
        const res = await fetch(`/?v=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const html = await res.text();
        const served = /<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(html)?.[1];
        if (!stopped && served && served !== mine) setStale(true);
      } catch {
        // Offline, or the server is mid-deploy: ask again later.
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    const timer = setInterval(() => void check(), 30_000);
    document.addEventListener('visibilitychange', onVisible);
    void check();
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Stale and nothing open over the page: reload now. Something open: look
  // again every few seconds and reload the moment it is gone.
  useEffect(() => {
    if (!stale) return;
    const tryReload = () => {
      if (!windowOpen()) window.location.reload();
    };
    tryReload();
    const timer = setInterval(tryReload, 3_000);
    return () => clearInterval(timer);
  }, [stale]);

  if (!stale) return null;
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="fixed bottom-4 right-4 z-[3000] rounded-full bg-brand px-4 py-2.5 text-sm font-bold text-white shadow-2xl hover:bg-brand-dark"
    >
      ↻ {t('common.newVersion')}
    </button>
  );
}

/** Form pages that are a whole page, not a window: never reloaded from under the writer. */
const FORM_PAGES = [/^\/orders\/new/, /^\/seller\/vozvrat\/new/];

/**
 * Something the person is in the middle of (owner, 06.11.2026): a modal or
 * sheet over the page, a whole-page form (a half-written new order was lost
 * to the reload), or a field being typed in anywhere.
 */
function windowOpen(): boolean {
  const el = document.activeElement;
  const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el as HTMLElement).isContentEditable);
  return (
    document.querySelector('[role="dialog"]') !== null ||
    document.querySelector('.fixed.inset-0.z-50') !== null ||
    FORM_PAGES.some((r) => r.test(window.location.pathname)) ||
    typing
  );
}
