import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import type { OrderPublic } from '@bigant/shared';

export function isOrderActionLocked(order: OrderPublic, now = Date.now()): boolean {
  if (!order.actions_available_at) return false;
  const availableAt = Date.parse(order.actions_available_at);
  return Number.isFinite(availableAt) && now < availableAt;
}

/** Re-renders order lists when the next scheduled booking reaches its unlock time.
 *  Returning to the app also refreshes the clock immediately. */
export function useOrderActivationClock(orders: readonly OrderPublic[]): number {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const currentTime = Date.now();
    const futureTimes = orders
      .map((order) =>
        order.actions_available_at ? Date.parse(order.actions_available_at) : Number.NaN,
      )
      .filter((time) => Number.isFinite(time) && time > currentTime);
    const nextTime = futureTimes.length > 0 ? Math.min(...futureTimes) : null;
    const timer =
      nextTime === null
        ? null
        : setTimeout(() => setNow(Date.now()), Math.max(0, nextTime - currentTime + 50));
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(Date.now());
    });

    return () => {
      if (timer) clearTimeout(timer);
      appStateSubscription.remove();
    };
  }, [orders, now]);

  return now;
}
