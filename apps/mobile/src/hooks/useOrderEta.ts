import { useQuery } from '@tanstack/react-query';
import { ACTIVE_ORDER_STATUSES, type OrderEta, type OrderPublic } from '@bigant/shared';
import { api } from '../lib/api';

/** How often the card re-asks. The phone reports its position every 15 s and
 *  the server caches by inputs, so this is cheap; anything faster just shows
 *  the same number again. */
const REFRESH_MS = 30_000;

/**
 * Live ETA for one order. Keyed under ['order', id, …] so the journey
 * mutations' invalidation of ['order', id] refreshes it too — after "arrived
 * at pickup" the next stop changes and the old number must not linger.
 */
export function useOrderEta(order: OrderPublic) {
  const active = (ACTIVE_ORDER_STATUSES as readonly string[]).includes(order.status) && order.status !== 'returning';
  return useQuery({
    queryKey: ['order', order.id, 'eta'],
    queryFn: () => api.get<OrderEta>(`/orders/${order.id}/eta`),
    enabled: active,
    refetchInterval: REFRESH_MS,
    staleTime: 10_000,
    retry: false,
  });
}
