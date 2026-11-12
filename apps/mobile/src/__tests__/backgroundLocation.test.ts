/** The position on shift: when the shift may start, and what the service does with a fix. */
import { Alert, AppState, Linking } from 'react-native';

type TaskBody = { data?: { locations?: { coords: { latitude: number; longitude: number }; timestamp: number }[] }; error?: unknown };
const mockTasks: Record<string, (b: TaskBody) => Promise<void>> = {};
jest.mock('expo-task-manager', () => ({
  defineTask: (name: string, fn: (b: TaskBody) => Promise<void>) => {
    mockTasks[name] = fn;
  },
}));

const mockLoc = {
  Accuracy: { High: 4 },
  ActivityType: { AutomotiveNavigation: 2 },
  hasServicesEnabledAsync: jest.fn(),
  enableNetworkProviderAsync: jest.fn(),
  getBackgroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  requestBackgroundPermissionsAsync: jest.fn(),
  hasStartedLocationUpdatesAsync: jest.fn(),
  startLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
  startGeofencingAsync: jest.fn().mockResolvedValue(undefined),
  stopGeofencingAsync: jest.fn().mockResolvedValue(undefined),
  hasStartedGeofencingAsync: jest.fn().mockResolvedValue(true),
  getLastKnownPositionAsync: jest.fn().mockResolvedValue(null),
};
jest.mock('expo-location', () => mockLoc);

const mockPost = jest.fn();
const mockEnsure = jest.fn();
jest.mock('../lib/api', () => ({ api: { post: mockPost }, ensureSession: mockEnsure, ApiError: class extends Error {} }));
let mockStored: string | null = null;
jest.mock('expo-file-system', () => ({
  Paths: { document: 'doc' },
  File: class {
    get exists() {
      return mockStored !== null;
    }
    textSync() {
      return mockStored ?? '';
    }
    create() {
      mockStored = '';
    }
    write(v: string) {
      mockStored = v;
    }
    delete() {
      mockStored = null;
    }
  },
}));

const mockGuard = { overlay: true, openOverlay: jest.fn(), battery: true, request: jest.fn(), autostart: false, openAuto: jest.fn(), confirmAuto: jest.fn() };
jest.mock('../lib/gpsGuard', () => ({
  gpsGuard: {
    canDrawOverlays: () => mockGuard.overlay,
    openOverlaySettings: () => mockGuard.openOverlay(),
    batteryUnrestricted: () => mockGuard.battery,
    requestBatteryUnrestricted: () => mockGuard.request(),
    autostartNeeded: () => mockGuard.autostart,
    openAutostart: () => mockGuard.openAuto(),
    confirmAutostart: () => mockGuard.confirmAuto(),
    setRequired: jest.fn(),
    setGpsOnly: jest.fn(),
  },
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ensureShiftLocation, startBackgroundLocation, stopBackgroundLocation } = require('../lib/backgroundLocation');
const t = ((k: string) => k) as never;
const fix = { data: { locations: [{ coords: { latitude: 41.3, longitude: 69.2 }, timestamp: Date.now() }] } };
const task = () => mockTasks['bigant-shift-location']!;

/** Every alert pressed on its last button: "Davom etish" / "Sozlamalar". */
const pressLast = () =>
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _b, buttons) => buttons?.[buttons.length - 1]?.onPress?.());

beforeEach(() => {
  jest.clearAllMocks();
  mockGuard.battery = true;
  mockGuard.autostart = false;
  mockGuard.overlay = true;
  mockStored = null;
  mockEnsure.mockResolvedValue(undefined);
  mockLoc.hasServicesEnabledAsync.mockResolvedValue(true);
  mockLoc.getBackgroundPermissionsAsync.mockResolvedValue({ granted: false });
  mockLoc.requestForegroundPermissionsAsync.mockResolvedValue({ granted: true });
  mockLoc.requestBackgroundPermissionsAsync.mockResolvedValue({ granted: true });
  mockLoc.hasStartedLocationUpdatesAsync.mockResolvedValue(false);
  jest.spyOn(Linking, 'openSettings').mockResolvedValue();
  pressLast();
});

describe('before a shift starts', () => {
  it('an alert gone without a button (a call, another alert) does not hang the shift button (owner, 07.11.2026)', async () => {
    mockLoc.requestBackgroundPermissionsAsync.mockResolvedValue({ granted: false });
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _b, _buttons, opts) => opts?.onDismiss?.());
    // Settles: the "Sozlamalar" question dismissed counts as Bekor qilish.
    expect(await ensureShiftLocation(t)).toBe(false);
    expect(Linking.openSettings).not.toHaveBeenCalled();
    expect((Alert.alert as jest.Mock).mock.calls[0][3]).toMatchObject({ cancelable: true });
  });

  it('passes at once when "all the time" is already allowed', async () => {
    mockLoc.getBackgroundPermissionsAsync.mockResolvedValue({ granted: true });
    expect(await ensureShiftLocation(t)).toBe(true);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('asks, and passes when he allows it', async () => {
    expect(await ensureShiftLocation(t)).toBe(true);
    expect(mockLoc.requestBackgroundPermissionsAsync).toHaveBeenCalled();
  });

  it('refuses the shift when he allows only "while using", and offers settings', async () => {
    mockLoc.requestBackgroundPermissionsAsync.mockResolvedValue({ granted: false });
    expect(await ensureShiftLocation(t)).toBe(false);
    expect(Linking.openSettings).toHaveBeenCalled();
  });

  it('battery not unrestricted: Android asks, and Allow lets the shift start (owner, 04.11.2026)', async () => {
    mockLoc.getBackgroundPermissionsAsync.mockResolvedValue({ granted: true });
    mockGuard.battery = false;
    let listener: ((s: string) => void) | null = null;
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_e: string, fn: (s: string) => void) => {
      listener = fn;
      return { remove: jest.fn() };
    }) as never);
    mockGuard.request.mockImplementation(() => {
      setTimeout(() => {
        listener?.('background');
        mockGuard.battery = true;
        listener?.('active');
      }, 0);
    });
    expect(await ensureShiftLocation(t)).toBe(true);
    expect(mockGuard.request).toHaveBeenCalled();
  });

  it('battery permission refused: no shift, and settings are offered', async () => {
    mockLoc.getBackgroundPermissionsAsync.mockResolvedValue({ granted: true });
    mockGuard.battery = false;
    let listener: ((s: string) => void) | null = null;
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_e: string, fn: (s: string) => void) => {
      listener = fn;
      return { remove: jest.fn() };
    }) as never);
    mockGuard.request.mockImplementation(() => {
      setTimeout(() => {
        listener?.('background');
        listener?.('active');
      }, 0);
    });
    expect(await ensureShiftLocation(t)).toBe(false);
    expect(Linking.openSettings).toHaveBeenCalled();
  });

  it('Xiaomi and the like: the autostart page is opened, and "Ha, yoqdim" lets the shift start (owner, 05.11.2026)', async () => {
    mockLoc.getBackgroundPermissionsAsync.mockResolvedValue({ granted: true });
    mockGuard.autostart = true;
    let listener: ((s: string) => void) | null = null;
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_e: string, fn: (s: string) => void) => {
      listener = fn;
      return { remove: jest.fn() };
    }) as never);
    mockGuard.openAuto.mockImplementation(() => {
      setTimeout(() => {
        listener?.('background');
        listener?.('active');
      }, 0);
    });
    expect(await ensureShiftLocation(t)).toBe(true);
    expect(mockGuard.openAuto).toHaveBeenCalled();
    expect(mockGuard.confirmAuto).toHaveBeenCalled();
  });

  it('overlay still not given on return: the refusal is said, and its page offered (audit, 07.11.2026)', async () => {
    mockLoc.getBackgroundPermissionsAsync.mockResolvedValue({ granted: true });
    mockGuard.overlay = false;
    let listener: ((s: string) => void) | null = null;
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_e: string, fn: (s: string) => void) => {
      listener = fn;
      return { remove: jest.fn() };
    }) as never);
    mockGuard.openOverlay.mockImplementationOnce(() => {
      setTimeout(() => {
        listener?.('background');
        listener?.('active');
      }, 0);
    });
    expect(await ensureShiftLocation(t)).toBe(false);
    const bodies = (Alert.alert as jest.Mock).mock.calls.map((c) => c[1]);
    expect(bodies).toContain('guard.overlayRefused');
    // Once to ask, once more from "Sozlamalar" on the refusal.
    expect(mockGuard.openOverlay).toHaveBeenCalledTimes(2);
  });

  it("autostart answered Yo'q: the refusal is said, not a silent no (audit, 07.11.2026)", async () => {
    mockLoc.getBackgroundPermissionsAsync.mockResolvedValue({ granted: true });
    mockGuard.autostart = true;
    let listener: ((s: string) => void) | null = null;
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_e: string, fn: (s: string) => void) => {
      listener = fn;
      return { remove: jest.fn() };
    }) as never);
    mockGuard.openAuto.mockImplementationOnce(() => {
      setTimeout(() => {
        listener?.('background');
        listener?.('active');
      }, 0);
    });
    // "Yo'q" on the question, the last button everywhere else.
    jest.spyOn(Alert, 'alert').mockImplementation((_t, body, buttons) =>
      (body === 'guard.autostartAsk' ? buttons?.[0] : buttons?.[buttons.length - 1])?.onPress?.(),
    );
    expect(await ensureShiftLocation(t)).toBe(false);
    const bodies = (Alert.alert as jest.Mock).mock.calls.map((c) => c[1]);
    expect(bodies).toContain('guard.autostartRefused');
    expect(mockGuard.confirmAuto).not.toHaveBeenCalled();
  });

  it('refuses the shift with the GPS off', async () => {
    mockLoc.hasServicesEnabledAsync.mockResolvedValue(false);
    mockLoc.enableNetworkProviderAsync.mockRejectedValue(new Error('refused'));
    expect(await ensureShiftLocation(t)).toBe(false);
    expect(mockLoc.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it("GPS off: Android's own 'Включить' window first; turned on there, the shift goes on (owner, 04.11.2026)", async () => {
    mockLoc.hasServicesEnabledAsync.mockResolvedValueOnce(false).mockResolvedValue(true);
    mockLoc.enableNetworkProviderAsync.mockResolvedValue(undefined);
    mockLoc.getBackgroundPermissionsAsync.mockResolvedValue({ granted: true });
    expect(await ensureShiftLocation(t)).toBe(true);
    expect(mockLoc.enableNetworkProviderAsync).toHaveBeenCalled();
  });
});

describe('the service', () => {
  it('does not start without the permission, and survives the app being closed when it does', async () => {
    expect(await startBackgroundLocation(t)).toBe(false);
    mockLoc.getBackgroundPermissionsAsync.mockResolvedValue({ granted: true });
    expect(await startBackgroundLocation(t)).toBe(true);
    const options = mockLoc.startLocationUpdatesAsync.mock.calls[0][1];
    expect(options.foregroundService.killServiceOnDestroy).toBe(false);
    // iPhone: the blue bar Apple requires, and driving as the movement (06.11.2026).
    expect(options.showsBackgroundLocationIndicator).toBe(true);
    expect(options.activityType).toBe(2);
  });

  it('sends the last fix, with a session even if the app was closed', async () => {
    mockPost.mockResolvedValue({ on_shift: true });
    await task()(fix);
    expect(mockEnsure).toHaveBeenCalled();
    expect(mockPost).toHaveBeenCalledWith('/drivers/me/location', { lat: 41.3, lng: 69.2 });
    expect(mockLoc.stopLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it('stops itself when the server says the shift is closed', async () => {
    mockPost.mockResolvedValue({ on_shift: false });
    mockLoc.hasStartedLocationUpdatesAsync.mockResolvedValue(true);
    await task()(fix);
    expect(mockLoc.stopLocationUpdatesAsync).toHaveBeenCalled();
  });

  it('keeps running through a lost connection, and keeps the fix for later (owner, 04.11.2026)', async () => {
    mockPost.mockRejectedValue(new Error('network'));
    await expect(task()(fix)).resolves.toBeUndefined();
    expect(mockLoc.stopLocationUpdatesAsync).not.toHaveBeenCalled();
    expect(JSON.parse(mockStored!)).toEqual([expect.objectContaining({ lat: 41.3, lng: 69.2 })]);
    mockPost.mockResolvedValue({ on_shift: true });
    await task()(fix);
    expect(mockPost).toHaveBeenLastCalledWith('/drivers/me/location/batch', { points: [expect.anything(), expect.anything()], sent_at: expect.any(String) });
    expect(mockStored).toBeNull();
  });
});

describe('iPhone: the wake fence (10.11.2026)', () => {
  it('a fix on shift puts a fence round where the phone is; the shift ending takes it away', async () => {
    mockPost.mockResolvedValue({ on_shift: true });
    // Far from any fence an earlier case left (the fence lives for the module).
    await task()({ data: { locations: [{ coords: { latitude: 40.1, longitude: 65.4 }, timestamp: Date.now() }] } });
    expect(mockLoc.startGeofencingAsync).toHaveBeenCalledWith(
      'bigant-wake-fence',
      [expect.objectContaining({ latitude: 40.1, longitude: 65.4, notifyOnExit: true })],
    );
    mockLoc.hasStartedLocationUpdatesAsync.mockResolvedValue(false);
    await stopBackgroundLocation();
    expect(mockLoc.stopGeofencingAsync).toHaveBeenCalledWith('bigant-wake-fence');
  });

  it('leaving the fence moves it to where the phone is now', async () => {
    mockLoc.getLastKnownPositionAsync.mockResolvedValue({ coords: { latitude: 41.4, longitude: 69.3 } });
    mockLoc.startGeofencingAsync.mockClear();
    await mockTasks['bigant-wake-fence']!({});
    expect(mockLoc.startGeofencingAsync).toHaveBeenCalledWith(
      'bigant-wake-fence',
      [expect.objectContaining({ latitude: 41.4, longitude: 69.3 })],
    );
  });
});
