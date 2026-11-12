import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { ACTIVE_ORDER_STATUSES, type DriverMe, type OrderPublic, type OrderStatus } from '@bigant/shared';
import { useAuth } from '../auth/AuthContext';
import { api, netState } from '../lib/api';
import { deliver, locationBacklog, syncBacklog } from '../lib/locationQueue';
import { ORDERS_LIST_KEY, fetchOrders } from '../lib/ordersQuery';
import { isOrderActionLocked, useOrderActivationClock } from './useOrderActivationClock';

// Every five seconds while the app is open (owner, 03.11.2026); the background service keeps its own, slower rhythm.
const INTERVAL_MS = 5_000;
// Gate closed with positions still kept: one try a minute besides each reconnect (owner, 07.11.2026).
const BACKLOG_RETRY_MS = 60_000;
// Same bound as the photo's fix (lib/fuel.ts captureFix): a GPS read that never answers must not hold the loop (audit, 07.11.2026).
const FIX_TIMEOUT_MS = 8_000;

const ACTIVE = ACTIVE_ORDER_STATUSES as readonly OrderStatus[];

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('location_timeout')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
};

/**
 * Whether the app may send his location (owner, 07.11.2026): only while his
 * shift is open ("Ishni boshladim" to "Ishni tugatdim", whatever the clock),
 * or while an order is in his hands — offered or under way — even after the
 * shift ended. An order still locked until its start time does not count yet.
 * Nothing known yet (first load) sends nothing.
 */
export function shouldSendLocation(
  driver: (Pick<DriverMe, 'shift_started_at'> & Partial<Pick<DriverMe, 'break_until' | 'break_started_at'>>) | undefined,
  orders: readonly OrderPublic[],
  now = Date.now(),
): boolean {
  // On a break too (owner, 12.11.2026, later): the position is kept, GPS stays on.
  if (driver?.shift_started_at) return true;
  return orders.some((o) => ACTIVE.includes(o.status) && !isOrderActionLocked(o, now));
}

export function useDriverLocation() {
  const { user } = useAuth();
  const isDriver = !!user && user.role === 'driver' && Platform.OS !== 'web';
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // Same keys and requests as the home screen (useShift / useCurrentOrder), so
  // React Query shares them instead of asking twice.
  const driverQ = useQuery({
    queryKey: ['driver', 'me'],
    queryFn: () => api.get<DriverMe>('/drivers/me'),
    refetchInterval: 15_000,
    enabled: isDriver,
  });
  const ordersQ = useQuery({
    queryKey: ORDERS_LIST_KEY,
    queryFn: fetchOrders,
    refetchInterval: 15_000,
    enabled: isDriver,
  });
  const orders = ordersQ.data ?? [];
  const now = useOrderActivationClock(orders);
  const allowed = isDriver && shouldSendLocation(driverQ.data, orders, now);

  // Positions kept on the phone while there was no internet still go after
  // the shift closed (owner, 07.11.2026): when the internet comes back, and
  // otherwise once a minute, until none is left. No new fix is taken here.
  useEffect(() => {
    if (!isDriver || allowed) return;
    let stopped = false;
    let busy = false;
    const flush = async () => {
      if (stopped || busy || locationBacklog.get() === 0) return;
      busy = true;
      try {
        await deliver([]);
      } catch {
        // Still no internet: the next reconnect or the next minute tries again.
      } finally {
        busy = false;
      }
    };
    void syncBacklog().catch(() => undefined);
    const off = netState.subscribe((on) => {
      if (on) void flush();
    });
    const timer = setInterval(() => void flush(), BACKLOG_RETRY_MS);
    return () => {
      stopped = true;
      off();
      clearInterval(timer);
    };
  }, [isDriver, allowed]);

  useEffect(() => {
    // The gate closed (shift ended, no order in hand): the cleanup below has
    // stopped the loop; it starts again when the gate opens (owner, 07.11.2026).
    if (!allowed) return;

    let cancelled = false;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || cancelled) return;

      // One tick at a time (audit, 07.11.2026): a slow fix or a slow send used
      // to let the next ticks pile up behind it, each holding its own GPS read.
      let busy = false;
      const send = async () => {
        if (busy || cancelled) return;
        busy = true;
        try {
          const pos = await withTimeout(
            // No Google "turn on location" sheet from here (owner, 12.11.2026): it
            // popped up every few seconds with GPS off, even on a break. Asking
            // is the red screen's job, and only when GPS is required.
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced, mayShowUserSettingsDialog: false }),
            FIX_TIMEOUT_MS,
          );
          // The gate may have closed while the fix was being read.
          if (cancelled) return;
          // Kept on the phone when there is no internet, sent with the next one that gets through.
          await deliver([
            { lat: pos.coords.latitude, lng: pos.coords.longitude, recorded_at: new Date(pos.timestamp).toISOString() },
          ]);
        } catch {
          // No GPS fix or no network: the next tick tries again.
        } finally {
          busy = false;
        }
      };

      if (cancelled) return;
      void send();
      intervalRef.current = setInterval(send, INTERVAL_MS);
    })();

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = undefined;
    };
  }, [allowed, user]);
}
