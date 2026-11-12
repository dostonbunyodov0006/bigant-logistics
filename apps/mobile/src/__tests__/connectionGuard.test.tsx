/** GPS and internet on every screen of the driver's app (owner, 04.11.2026). */
jest.setTimeout(30_000);
import { act, render, screen } from '@testing-library/react-native';

const mockGps = { on: true };
const mockAlways = { granted: true };
const mockPost = jest.fn().mockResolvedValue({ ok: true });
const mockLowPower = { on: false };
jest.mock('expo-battery', () => ({ isLowPowerModeEnabledAsync: () => Promise.resolve(mockLowPower.on) }));
jest.mock('expo-location', () => ({
  hasServicesEnabledAsync: () => Promise.resolve(mockGps.on),
  getBackgroundPermissionsAsync: () => Promise.resolve({ granted: mockAlways.granted }),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
const mockUser = { role: 'driver' };
jest.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
const mockNet = { on: true, fn: null as null | ((on: boolean) => void) };
jest.mock('../lib/api', () => ({
  api: { get: jest.fn(), post: mockPost },
  netState: { get: () => mockNet.on, subscribe: (fn: (on: boolean) => void) => ((mockNet.fn = fn), () => undefined) },
}));
jest.mock('../lib/locationQueue', () => ({ locationBacklog: { get: () => 0, subscribe: () => () => undefined } }));
jest.mock('../lib/backgroundLocation', () => ({ openGpsSettings: jest.fn() }));
const mockShift = { on: true, overlay: true, required: true, battery: true };
jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: {
      shift_started_at: mockShift.on ? '2026-11-04T04:00:00Z' : null,
      gps_required: mockShift.required
        ? { from: new Date(Date.now() - 60_000).toISOString(), until: new Date(Date.now() + 3_600_000).toISOString() }
        : null,
    },
  }),
}));
jest.mock('../lib/gpsGuard', () => ({
  gpsGuard: { canDrawOverlays: () => mockShift.overlay, openOverlaySettings: jest.fn(), available: () => false, batteryUnrestricted: () => mockShift.battery, requestBatteryUnrestricted: jest.fn(), autostartNeeded: () => false, openAutostart: jest.fn(), confirmAutostart: jest.fn() },
  gpsRequiredNow: (w: { from: string; until: string } | null) =>
    !!w && Date.now() >= Date.parse(w.from) && Date.now() < Date.parse(w.until),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ConnectionGuard } = require('../components/ConnectionGuard');

const flush = () => act(async () => {
  await Promise.resolve();
});

beforeEach(() => {
  mockGps.on = true;
  mockNet.on = true;
  mockUser.role = 'driver';
  mockShift.on = true;
  mockShift.overlay = true;
  mockShift.required = true;
  mockShift.battery = true;
  mockAlways.granted = true;
  mockLowPower.on = false;
  mockPost.mockClear();
});

describe('the connection guard', () => {
  it('GPS off: the red screen with one button covers the app', async () => {
    mockGps.on = false;
    render(<ConnectionGuard />);
    await flush();
    expect(screen.getByText('guard.gpsOffTitle')).toBeTruthy();
    expect(screen.getByText('guard.gpsTurnOn')).toBeTruthy();
  });

  it('GPS on and online: nothing is shown', async () => {
    render(<ConnectionGuard />);
    await flush();
    expect(screen.queryByText('guard.gpsOffTitle')).toBeNull();
    expect(screen.queryByText('guard.netOffTitle')).toBeNull();
  });

  it('the server cannot be reached: the red internet bar', async () => {
    render(<ConnectionGuard />);
    await flush();
    act(() => mockNet.fn?.(false));
    expect(screen.getByText('guard.netOffTitle')).toBeTruthy();
  });

  it('not a driver: nothing at all', async () => {
    mockUser.role = 'seller';
    mockGps.on = false;
    render(<ConnectionGuard />);
    await flush();
    expect(screen.queryByText('guard.gpsOffTitle')).toBeNull();
  });

  it('on shift without "display over other apps": a red screen asks for it', async () => {
    mockShift.overlay = false;
    render(<ConnectionGuard />);
    await flush();
    expect(screen.getByText('guard.overlayBlockTitle')).toBeTruthy();
  });

  it('off shift: the permission is asked when he starts work, not here', async () => {
    mockShift.overlay = false;
    mockShift.on = false;
    render(<ConnectionGuard />);
    await flush();
    expect(screen.queryByText('guard.overlayBlockTitle')).toBeNull();
  });

  it('GPS off after hours with nothing in hand: not required, no red screen (owner, 04.11.2026)', async () => {
    mockGps.on = false;
    mockShift.required = false;
    render(<ConnectionGuard />);
    await flush();
    expect(screen.queryByText('guard.gpsOffTitle')).toBeNull();
  });

  it('on shift without battery "Без ограничений": a red screen asks for it (owner, 04.11.2026)', async () => {
    mockShift.battery = false;
    render(<ConnectionGuard />);
    await flush();
    expect(screen.getByText('guard.batteryBlockTitle')).toBeTruthy();
  });
});

describe('iPhone: location below "Always" (10.11.2026)', () => {
  it('on shift with only "While Using": the screen asks for "Always"', async () => {
    mockAlways.granted = false;
    render(<ConnectionGuard />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByText('guard.iosAlwaysTitle')).toBeTruthy();
  });

  it('"Always" given: nothing', async () => {
    render(<ConnectionGuard />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryByText('guard.iosAlwaysTitle')).toBeNull();
  });
});

describe('iPhone: battery saver and the office (owner, 10.11.2026)', () => {
  it('Low Power Mode on shift: the screen says so and the office is told', async () => {
    mockLowPower.on = true;
    render(<ConnectionGuard />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByText('guard.iosLowPowerTitle')).toBeTruthy();
    expect(mockPost).toHaveBeenCalledWith('/app-health/device-state', { gps_off: false, low_power: true });
  });
});
