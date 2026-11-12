import { Alert, AppState, Linking, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import type { TFunction } from 'i18next';
import { ensureSession } from './api';
import { deliver } from './locationQueue';
import { gpsGuard } from './gpsGuard';

/**
 * The position on shift, whatever the phone is doing (owner, 02.11.2026): app
 * closed, screen locked, the navigator open. A foreground service sends it from
 * "Ishni boshladim" to "Ishni tugatish" and Android shows its notice meanwhile.
 * Off shift nothing is sent: the server says so on each fix when the shift was
 * closed elsewhere, and the service stops itself even with the app closed.
 */
const TASK = 'bigant-shift-location';
/** Every five minutes with the app closed, in his pocket (owner, 03.11.2026): the lorry still moves on the map, the battery lasts the day. */
const EVERY_MS = 5 * 60_000;

const native = Platform.OS !== 'web';

type TaskData = { locations?: Location.LocationObject[] };

/**
 * iPhone only (10.11.2026). iOS stops location updates when the driver swipes
 * the app away, and only a region event will start it again. So while the
 * shift runs, a small fence sits around where the phone last was; leaving it
 * relaunches the app in the background, the location task resumes, and the
 * fence moves to the new spot. Android has its own service and never uses this.
 */
const WAKE_TASK = 'bigant-wake-fence';
const WAKE_RADIUS_M = 150;
/** Moved this far from the fence's centre: it is re-centred. */
const WAKE_RECENTRE_M = 1000;
const ios = Platform.OS === 'ios';
let wakeCentre: { latitude: number; longitude: number } | null = null;

const metres = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) => {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
};

async function placeWakeFence(at: { latitude: number; longitude: number }): Promise<void> {
  if (!ios) return;
  wakeCentre = at;
  await Location.startGeofencingAsync(WAKE_TASK, [
    { identifier: 'bigant-here', latitude: at.latitude, longitude: at.longitude, radius: WAKE_RADIUS_M, notifyOnEnter: false, notifyOnExit: true },
  ]).catch(() => undefined);
}

async function moveWakeFenceIfFar(at: { latitude: number; longitude: number }): Promise<void> {
  if (!ios) return;
  if (wakeCentre && metres(wakeCentre, at) < WAKE_RECENTRE_M) return;
  await placeWakeFence(at);
}

async function stopWakeFence(): Promise<void> {
  if (!ios) return;
  wakeCentre = null;
  if (await Location.hasStartedGeofencingAsync(WAKE_TASK).catch(() => false)) {
    await Location.stopGeofencingAsync(WAKE_TASK).catch(() => undefined);
  }
}

if (ios) {
  // At module scope, like the location task: iOS relaunches the app with no screen.
  TaskManager.defineTask(WAKE_TASK, async ({ error }) => {
    if (error) return;
    // He left the fence: the location task is running again with the app; the
    // fence follows him.
    const here = await Location.getLastKnownPositionAsync().catch(() => null);
    if (here) await placeWakeFence(here.coords);
  });
}

if (native) {
  // At module scope: Android may start this code with no screen at all.
  TaskManager.defineTask<TaskData>(TASK, async ({ data, error }) => {
    if (error) return;
    const locations = data?.locations ?? [];
    if (locations.length === 0) return;
    // Every fix with the moment it was taken: without internet they are kept
    // on the phone and go with the next one that gets through.
    const last = locations[locations.length - 1]!;
    void moveWakeFenceIfFar(last.coords);
    const points = locations.map((l) => ({
      lat: l.coords.latitude,
      lng: l.coords.longitude,
      recorded_at: new Date(l.timestamp || Date.now()).toISOString(),
    }));
    try {
      // Started with the app closed there is no access token in memory yet.
      await Promise.resolve(ensureSession()).catch(() => undefined);
      const res = await deliver(points);
      // The server says when GPS must be on: the working hours, or while work is in hand.
      if (res && 'gps_required' in res) gpsGuard.setRequired(res.gps_required);
      if (res?.on_shift === false) {
        gpsGuard.setRequired(null);
        gpsGuard.setGpsOnly(null);
        await stopBackgroundLocation();
      }
    } catch {
      // No network this time: kept, and sent with the next fix.
    }
  });
}

/**
 * Turns location (GPS) on: Android's own "Включите точную геолокацию" window
 * with one "Включить" button (owner, 04.11.2026); if that is refused or not
 * there, its settings page.
 */
export async function openGpsSettings(): Promise<void> {
  if (Platform.OS === 'android') {
    try {
      await Location.enableNetworkProviderAsync();
      return;
    } catch {
      // Refused, or no Google services: the settings page instead.
    }
    try {
      await Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS');
      return;
    } catch {
      // Older phones: the app's settings page instead.
    }
  }
  await Linking.openSettings().catch(() => undefined);
}

export async function backgroundLocationRunning(): Promise<boolean> {
  if (!native) return false;
  return Location.hasStartedLocationUpdatesAsync(TASK).catch(() => false);
}

export async function stopBackgroundLocation(): Promise<void> {
  if (await backgroundLocationRunning()) {
    await Location.stopLocationUpdatesAsync(TASK).catch(() => undefined);
  }
  await stopWakeFence();
}

/** Starts the service if the "always" permission is there; false if it could not. */
export async function startBackgroundLocation(t: TFunction): Promise<boolean> {
  if (!native) return true;
  if (await backgroundLocationRunning()) return true;
  const bg = await Location.getBackgroundPermissionsAsync();
  if (!bg.granted) return false;
  try {
    await Location.startLocationUpdatesAsync(TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: EVERY_MS,
      // iPhone ignores timeInterval and, with 0 here, would send fixes
      // non-stop and drain the battery: every 50 m instead. Android unchanged.
      distanceInterval: Platform.OS === 'ios' ? 50 : 0,
      pausesUpdatesAutomatically: false,
      // iPhone: the blue bar while it runs (Apple requires it to be shown) and
      // driving as the kind of movement; Android ignores both.
      showsBackgroundLocationIndicator: true,
      activityType: Location.ActivityType.AutomotiveNavigation,
      foregroundService: {
        notificationTitle: t('shift.locNoticeTitle'),
        notificationBody: t('shift.locNoticeBody'),
        notificationColor: '#14181f',
        killServiceOnDestroy: false,
      },
    });
    return true;
  } catch {
    return false;
  }
}

const ask = (title: string, body: string, buttons: { text: string; value: boolean }[]) =>
  new Promise<boolean>((resolve) => {
    Alert.alert(
      title,
      body,
      buttons.map((b) => ({ text: b.text, onPress: () => resolve(b.value) })),
      // Gone without a button (another alert, a call): a no, not a hang (owner, 07.11.2026).
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });

/** "Sozlamalar" opens the app's settings page, or the page for that permission when given. */
const refused = async (t: TFunction, body: string, openPage?: () => void) => {
  const open = await ask(t('shift.locNeededTitle'), body, [
    { text: t('common.cancel'), value: false },
    { text: t('shift.locOpenSettings'), value: true },
  ]);
  if (open) {
    if (openPage) openPage();
    else await Linking.openSettings().catch(() => undefined);
  }
  return false;
};

/**
 * Before a shift: GPS on and the location allowed "all the time", or the shift
 * does not start — the office would see a lorry that is not there.
 */
export async function ensureShiftLocation(t: TFunction): Promise<boolean> {
  if (!native) return true;
  if (!(await Location.hasServicesEnabledAsync().catch(() => true))) {
    // Android's own "turn location on" window first; the settings page only if refused.
    await Location.enableNetworkProviderAsync().catch(() => undefined);
    if (!(await Location.hasServicesEnabledAsync().catch(() => true))) return refused(t, t('shift.locGpsOff'));
  }
  if ((await Location.getBackgroundPermissionsAsync()).granted) return ensureOverlay(t);

  // Android opens its settings page for "all the time": say why first.
  const ios = Platform.OS === 'ios';
  await ask(t('shift.locNeededTitle'), t(ios ? 'shift.locWhyIos' : 'shift.locWhy'), [{ text: t('shift.locContinue'), value: true }]);
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return refused(t, t(ios ? 'shift.locRefusedIos' : 'shift.locRefused'));
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (!bg.granted) return refused(t, t(ios ? 'shift.locRefusedIos' : 'shift.locRefused'));
  return ensureOverlay(t);
}

/**
 * "Display over other apps" (owner, 04.11.2026): with it the red GPS screen
 * comes up over the home screen when GPS is turned off with the app closed.
 * Asked once; the shift does not start without it.
 */
async function ensureOverlay(t: TFunction): Promise<boolean> {
  if (!gpsGuard.canDrawOverlays()) {
    await ask(t('guard.overlayTitle'), t('guard.overlayWhy'), [{ text: t('shift.locContinue'), value: true }]);
    gpsGuard.openOverlaySettings();
    await backInApp();
    // Still not given: said, as the battery step does, not a start button that
    // silently does nothing (audit, 07.11.2026).
    if (!gpsGuard.canDrawOverlays()) return refused(t, t('guard.overlayRefused'), () => gpsGuard.openOverlaySettings());
  }
  return ensureBattery(t);
}

/**
 * Battery "Без ограничений" (owner, 04.11.2026): without it Android holds back
 * the position and the network with the app closed — the office loses the
 * lorry and the driver is told his GPS is off when it is not. Android's own
 * window asks; "Разрешить" and the shift goes on. No shift without it.
 */
async function ensureBattery(t: TFunction): Promise<boolean> {
  if (gpsGuard.batteryUnrestricted()) return ensureAutostart(t);
  await ask(t('guard.batteryTitle'), t('guard.batteryWhy'), [{ text: t('shift.locContinue'), value: true }]);
  gpsGuard.requestBatteryUnrestricted();
  await backInApp();
  if (gpsGuard.batteryUnrestricted()) return ensureAutostart(t);
  return refused(t, t('guard.batteryRefused'));
}

/**
 * Xiaomi, Oppo, Vivo, Huawei (owner, 05.11.2026): their own autostart switch,
 * which no app can turn on or read. The page is opened; back in the app he
 * says whether he turned BIGANT on. No shift until he has.
 */
async function ensureAutostart(t: TFunction): Promise<boolean> {
  if (!gpsGuard.autostartNeeded()) return true;
  await ask(t('guard.autostartTitle'), t('guard.autostartWhy'), [{ text: t('shift.locContinue'), value: true }]);
  gpsGuard.openAutostart();
  await backInApp();
  const done = await ask(t('guard.autostartTitle'), t('guard.autostartAsk'), [
    { text: t('guard.autostartNo'), value: false },
    { text: t('guard.autostartYes'), value: true },
  ]);
  // "Yo'q": told why the shift did not start (audit, 07.11.2026).
  if (!done) return refused(t, t('guard.autostartRefused'), () => gpsGuard.openAutostart());
  gpsGuard.confirmAutostart();
  return true;
}

/** Resolves when the app is in front again after a system window, or after a minute. */
function backInApp(): Promise<void> {
  return new Promise((resolve) => {
    let left = false;
    const done = () => {
      sub.remove();
      clearTimeout(timer);
      // A beat for Android to record the answer.
      setTimeout(resolve, 400);
    };
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') left = true;
      else if (left) done();
    });
    const timer = setTimeout(done, 60_000);
  });
}
