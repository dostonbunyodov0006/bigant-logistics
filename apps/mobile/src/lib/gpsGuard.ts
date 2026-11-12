import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { report } from './crashReport';

/**
 * The red GPS screen over the phone with the app closed (owner, 04.11.2026):
 * the native side brings the app to the front when GPS goes off on shift. Only
 * in APK 1.2.0 and later; on an older APK every call here is a quiet no-op.
 */
type Native = {
  setShiftActive(on: boolean): void;
  setWindow?(fromMs: number, untilMs: number): void;
  canDrawOverlays(): boolean;
  openOverlaySettings(): void;
  isIgnoringBatteryOptimizations?(): boolean;
  requestIgnoreBatteryOptimizations?(): void;
  startTracking?(baseUrl: string, key: string, intervalMs: number): string | void;
  resumeTrackingError?(): string;
  flushTracking?(): Promise<boolean>;
  stopTracking?(): void;
  isTracking?(): boolean;
  resumeTracking?(): boolean;
  forgetTracking?(): void;
  autostartNeeded?(): boolean;
  openAutostart?(): void;
  confirmAutostart?(): void;
  setBreakEnd?(ms: number): void;
  setGpsOnlyWindow?(fromMs: number, untilMs: number): void;
  consumeAction?(): string;
};

const native: Native | null = Platform.OS === 'android' ? requireOptionalNativeModule<Native>('GpsGuard') : null;

export const gpsGuard = {
  /** Whether this APK has the guard at all. */
  available: () => native !== null,
  setShiftActive(on: boolean) {
    try {
      native?.setShiftActive(on);
    } catch {
      // Not there: nothing to tell.
    }
  },
  /**
   * When GPS must be on, as the server worked it out (owner, 04.11.2026):
   * working hours, or while work is in hand. Null: not now.
   */
  setRequired(window: { from: string; until: string } | null | undefined) {
    const from = window ? Date.parse(window.from) : 0;
    const until = window ? Date.parse(window.until) : 0;
    try {
      if (native?.setWindow) native.setWindow(from, until);
      else native?.setShiftActive(Date.now() >= from && Date.now() < until);
    } catch {
      // Not there: nothing to tell.
    }
  },
  /** "Display over other apps" given; true where there is no guard to need it. */
  canDrawOverlays(): boolean {
    try {
      return native ? native.canDrawOverlays() : true;
    } catch {
      return true;
    }
  },
  /** Battery "Без ограничений" given; true where this APK cannot tell. */
  batteryUnrestricted(): boolean {
    try {
      return native?.isIgnoringBatteryOptimizations ? native.isIgnoringBatteryOptimizations() : true;
    } catch {
      return true;
    }
  },
  /** Android's own "Разрешить" window for "Без ограничений". */
  requestBatteryUnrestricted() {
    try {
      native?.requestIgnoreBatteryOptimizations?.();
    } catch {
      // Nothing to open.
    }
  },
  /**
   * On a break, GPS alone must stay on (owner, 12.11.2026): internet and battery
   * saver are not asked. APK 1.4.2+; an older one asks nothing on a break.
   */
  setGpsOnly(window: { from: string; until: string } | null | undefined) {
    try {
      native?.setGpsOnlyWindow?.(window ? Date.parse(window.from) : 0, window ? Date.parse(window.until) : 0);
    } catch {
      // An older APK.
    }
  },
  /** When the break ends, for the red screen's "extend the break" button (1.4.1+); 0 for none. */
  setBreakEnd(ms: number) {
    try {
      native?.setBreakEnd?.(ms);
    } catch {
      // An older APK: no such button.
    }
  },
  /** What was pressed on the red screen to open the app ("extend_break"), once; "" for nothing. */
  consumeAction(): string {
    try {
      return String(native?.consumeAction?.() ?? '');
    } catch {
      return '';
    }
  },
  /** This APK sends the shift's position itself (1.2.7 and later). */
  tracksNatively: () => !!native?.startTracking,
  isTracking(): boolean {
    try {
      return !!native?.isTracking?.();
    } catch {
      return false;
    }
  },
  /** "" when started; otherwise why not. */
  startTracking(baseUrl: string, key: string, intervalMs: number): string {
    try {
      return String(native?.startTracking?.(baseUrl, key, intervalMs) ?? '');
    } catch (e) {
      return String(e);
    }
  },
  stopTracking() {
    try {
      native?.stopTracking?.();
    } catch {
      // Nothing to stop.
    }
  },
  /** On again with the key it was given before; false when there is none yet. */
  resumeTracking(): boolean {
    try {
      if (native?.resumeTrackingError) {
        const err = native.resumeTrackingError();
        if (err && err !== 'no-key') report(new Error(`native location resume failed: ${err}`));
        return err === '';
      }
      return !!native?.resumeTracking?.();
    } catch (e) {
      report(new Error(`native location resume threw: ${String(e)}`));
      return false;
    }
  },
  /** A Xiaomi/Oppo/Vivo/Huawei phone whose own autostart switch the driver has not said he turned on. */
  autostartNeeded(): boolean {
    try {
      return !!native?.autostartNeeded?.();
    } catch {
      return false;
    }
  },
  openAutostart() {
    try {
      native?.openAutostart?.();
    } catch {
      // Nothing to open.
    }
  },
  confirmAutostart() {
    try {
      native?.confirmAutostart?.();
    } catch {
      // Nothing to keep.
    }
  },
  /**
   * Everything the phone kept, sent now (owner, 05.11.2026): before the shift
   * ends, so the road home is on the server when the evening extra is worked
   * out. Never waits more than 25 s.
   */
  async flushTracking(): Promise<void> {
    try {
      if (!native?.flushTracking) return;
      await Promise.race([native.flushTracking(), new Promise((resolve) => setTimeout(resolve, 25_000))]);
    } catch {
      // Not sent now: the server works the shift out again when they arrive.
    }
  },
  /** Signed out: the service stops and forgets the key. */
  forgetTracking() {
    try {
      native?.forgetTracking?.();
    } catch {
      // Nothing to forget.
    }
  },
  openOverlaySettings() {
    try {
      native?.openOverlaySettings();
    } catch {
      // Nothing to open.
    }
  },
};

/** Whether GPS is required at this moment. */
export function gpsRequiredNow(window: { from: string; until: string } | null | undefined, now = Date.now()): boolean {
  return !!window && now >= Date.parse(window.from) && now < Date.parse(window.until);
}
