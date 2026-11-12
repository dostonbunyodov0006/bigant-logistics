import type { OrderPublic } from '@bigant/shared';

/** A driver-side order with only what a test sets; the rest is filler of the right shape. */
export function order(over: Partial<OrderPublic> = {}): OrderPublic {
  return {
    id: 'o1',
    order_number: 1,
    status: 'driver_accepted',
    client_name: 'Aziz',
    client_phone_number: '+998900000101',
    client_address: 'Uzar ko‘chasi 65',
    delivery_datetime: '2026-10-29T07:00:00.000Z',
    actions_available_at: null,
    start_after_nine: false,
    return_deferred_at: null,
    next_action: { type: 'depart_pickup', pickup_id: 'p1' },
    pickup_sources: [],
    items: [],
    created_by_seller_name: 'Nodir',
    created_by_seller_phone_number: '+998900000102',
    ...over,
  } as unknown as OrderPublic;
}
