/**
 * Tells the server when the app's JavaScript dies.
 *
 * Imported first of all in App.tsx, so the handler is in place before any
 * other module of ours is evaluated: a mistake that throws while a screen is
 * being loaded is reported too, not only one in a tap handler. The phones are
 * out of reach of any debugger, and an update that dies at start-up is quietly
 * rolled back by the updater, so without this a broken update looks, from the
 * office, exactly like a driver who never restarted the app.
 *
 * It sends one small POST and then hands the error on to whatever handler was
 * there before, so nothing about how the app fails is changed — only that it
 * is now known. It imports nothing of ours and no updater: the reporter must
 * never be the thing that fails.
 */
import Constants from 'expo-constants';

const API = ((Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? 'https://logistics.example.com/api').replace(/\/$/, '');

type Handler = (error: unknown, isFatal?: boolean) => void;
type Utils = { getGlobalHandler: () => Handler | undefined; setGlobalHandler: (h: Handler) => void };

export function report(error: unknown, isFatal?: boolean): void {
  try {
    const e = error as { message?: unknown; stack?: unknown } | null;
    const body = JSON.stringify({
      fatal: isFatal === true,
      version: Constants.expoConfig?.version ?? null,
      at: new Date().toISOString(),
      message: typeof e?.message === 'string' ? e.message : String(error),
      stack: typeof e?.stack === 'string' ? e.stack.slice(0, 4000) : null,
    });
    void fetch(`${API}/health/client-error`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    }).catch(() => undefined);
  } catch {
    // The reporter must never be the thing that fails.
  }
}

const utils = (globalThis as { ErrorUtils?: Utils }).ErrorUtils;
if (utils) {
  const previous = utils.getGlobalHandler();
  utils.setGlobalHandler((error, isFatal) => {
    report(error, isFatal);
    previous?.(error, isFatal);
  });
}
