/** The app sends his location only on shift or with an order in hand (owner, 07.11.2026). */
jest.setTimeout(30_000);
import { act, renderHook } from '@testing-library/react-native';
import { order } from './fixtures';

const mockDeliver = jest.fn((_points: unknown[]) => Promise.resolve());
const mockBacklog = { n: 0 };
jest.mock('../lib/locationQueue', () => ({
  deliver: (p: unknown[]) => mockDeliver(p),
  locationBacklog: { get: () => mockBacklog.n, subscribe: () => () => undefined },
  syncBacklog: () => Promise.resolve(mockBacklog.n),
}));
const mockNet = { fn: null as null | ((on: boolean) => void) };
jest.mock('../lib/api', () => ({
  api: { get: jest.fn() },
  netState: {
    get: () => true,
    subscribe: (fn: (on: boolean) => void) => ((mockNet.fn = fn), () => (mockNet.fn = null)),
  },
}));
jest.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: { role: 'driver' } }) }));
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: () => Promise.resolve({ status: 'granted' }),
  getCurrentPositionAsync: () =>
    Promise.resolve({ coords: { latitude: 41.3, longitude: 69.2 }, timestamp: Date.parse('2026-11-07T05:00:00Z') }),
}));
const mockState = { shiftStartedAt: null as string | null, orders: [] as unknown[] };
jest.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: readonly string[] }) => ({
    data: queryKey[0] === 'driver' ? { shift_started_at: mockState.shiftStartedAt } : mockState.orders,
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useDriverLocation, shouldSendLocation } = require('../hooks/useDriverLocation');

const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });

beforeEach(() => {
  mockDeliver.mockClear();
  mockBacklog.n = 0;
  mockNet.fn = null;
  mockState.shiftStartedAt = null;
  mockState.orders = [];
});

describe('the app-open location loop', () => {
  it('shift closed and no order in hand: nothing is sent', async () => {
    const { unmount } = renderHook(() => useDriverLocation());
    await flush();
    expect(mockDeliver).not.toHaveBeenCalled();
    unmount();
  });

  it('shift open: his location is sent', async () => {
    mockState.shiftStartedAt = '2026-11-07T03:30:00Z';
    const { unmount } = renderHook(() => useDriverLocation());
    await flush();
    expect(mockDeliver).toHaveBeenCalledTimes(1);
    expect(mockDeliver.mock.calls[0][0]).toEqual([{ lat: 41.3, lng: 69.2, recorded_at: '2026-11-07T05:00:00.000Z' }]);
    unmount();
  });

  it('shift closed but an order in hand: his location is sent', async () => {
    mockState.orders = [order({ status: 'on_the_way' })];
    const { unmount } = renderHook(() => useDriverLocation());
    await flush();
    expect(mockDeliver).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('the shift ends with no order: the loop stops', async () => {
    jest.useFakeTimers();
    try {
      mockState.shiftStartedAt = '2026-11-07T03:30:00Z';
      const { rerender, unmount } = renderHook(() => useDriverLocation());
      await flush();
      expect(mockDeliver).toHaveBeenCalledTimes(1);
      mockState.shiftStartedAt = null;
      rerender({});
      await flush();
      await act(async () => {
        jest.advanceTimersByTime(20_000);
      });
      await flush();
      expect(mockDeliver).toHaveBeenCalledTimes(1);
      unmount();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('positions kept after the shift closed (owner, 07.11.2026)', () => {
  it('gate closed with a backlog: the kept positions go when the internet returns', async () => {
    mockBacklog.n = 12;
    const { unmount } = renderHook(() => useDriverLocation());
    await flush();
    expect(mockDeliver).not.toHaveBeenCalled(); // no new fix is taken
    await act(async () => {
      mockNet.fn?.(true);
    });
    await flush();
    expect(mockDeliver).toHaveBeenCalledTimes(1);
    expect(mockDeliver.mock.calls[0][0]).toEqual([]);
    unmount();
    expect(mockNet.fn).toBeNull();
  });

  it('gate closed with a backlog: tried once a minute without a reconnect, until it is empty', async () => {
    jest.useFakeTimers();
    try {
      mockBacklog.n = 3;
      const { unmount } = renderHook(() => useDriverLocation());
      await flush();
      await act(async () => {
        jest.advanceTimersByTime(59_000);
      });
      expect(mockDeliver).not.toHaveBeenCalled();
      await act(async () => {
        jest.advanceTimersByTime(1_000);
      });
      await flush();
      expect(mockDeliver).toHaveBeenCalledTimes(1);
      expect(mockDeliver.mock.calls[0][0]).toEqual([]);
      mockBacklog.n = 0;
      await act(async () => {
        jest.advanceTimersByTime(120_000);
      });
      await flush();
      expect(mockDeliver).toHaveBeenCalledTimes(1);
      unmount();
    } finally {
      jest.useRealTimers();
    }
  });

  it('gate closed and nothing kept: nothing is sent, even on a reconnect', async () => {
    const { unmount } = renderHook(() => useDriverLocation());
    await flush();
    await act(async () => {
      mockNet.fn?.(true);
    });
    await flush();
    expect(mockDeliver).not.toHaveBeenCalled();
    unmount();
  });

  it('gate open: the reconnect listener is not there (the live loop sends the backlog)', async () => {
    mockState.shiftStartedAt = '2026-11-07T03:30:00Z';
    mockBacklog.n = 5;
    const { unmount } = renderHook(() => useDriverLocation());
    await flush();
    expect(mockNet.fn).toBeNull();
    unmount();
  });
});

describe('shouldSendLocation', () => {
  const now = Date.parse('2026-11-07T05:00:00Z');
  it('an offered order counts; one still locked until its start time does not', () => {
    expect(shouldSendLocation({ shift_started_at: null }, [order({ status: 'assigned_to_driver' })], now)).toBe(true);
    expect(
      shouldSendLocation(
        { shift_started_at: null },
        [order({ status: 'assigned_to_driver', actions_available_at: '2026-11-07T13:00:00Z' })],
        now,
      ),
    ).toBe(false);
  });
  it('nothing known yet sends nothing', () => {
    expect(shouldSendLocation(undefined, [], now)).toBe(false);
  });
});
