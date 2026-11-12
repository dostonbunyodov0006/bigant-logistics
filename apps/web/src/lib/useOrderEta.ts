import { useQuery } from '@tanstack/react-query';
import type { OrderEta } from '@bigant/shared';
import { api } from './api';

/** Live ETA for one order, refreshed every 30 s while the component is on
 *  screen. The server caches by inputs and the driver's position only moves
 *  every 15 s, so polling faster would just repeat the same number. */
export function useOrderEta(orderId: string | null | undefined) {
  return useQuery({
    queryKey: ['order', orderId, 'eta'],
    queryFn: () => api.get<OrderEta>(`/orders/${orderId}/eta`),
    enabled: !!orderId,
    refetchInterval: 30_000,
    staleTime: 10_000,
    retry: false,
  });
}
