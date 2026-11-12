import { ACTIVE_ORDER_STATUSES, type OrderPublic } from '@bigant/shared';
import { api } from './api';

/**
 * The driver's order list, shared by every screen that needs it.
 *
 * Several places want a different slice of the same list (the current journey
 * card, the header's carried-return badge). Sharing one key and one queryFn
 * means React Query fetches it once and each caller narrows it with its own
 * `select`, instead of each screen putting the same request on its own timer.
 */
export const ORDERS_LIST_KEY = ['orders', 'list'] as const;

export const fetchOrders = (): Promise<OrderPublic[]> =>
  api.get<OrderPublic[]>(`/orders?statuses=${ACTIVE_ORDER_STATUSES.join(',')}`);
