import type { OrderKind, OrderStatus } from './enums';

/**
 * Order status state machine (PROJECT_PLAN.md §3, requirements §11).
 *
 *   created → assigned_to_driver → driver_accepted → collecting_items
 *     → items_collected → on_the_way → arrived_at_customer → delivered
 *
 *   The pickup phase (collecting_items) advances place-by-place: each
 *   OrderPickupSource carries its own leg status (pending → en_route → arrived).
 *   arrived_at_customer is the "Mijozga yetib keldim" step; the outcome buttons
 *   (deliver / exception / return) branch from there.
 *
 *   Cancellation is progress-aware: before pickup travel it becomes `cancelled`;
 *   after travel starts it may credit that pickup, and collected goods branch to
 *   per-pickup `returning` stops instead of disappearing from the driver workflow.
 *   An Istisno is a report attached to an active order; it does not transition
 *   the order. The legacy `problem` status remains terminal for historical rows.
 *   created:   from assigned_to_driver (driver rejected — back to the pool)
 *
 *   on_the_way → delivered is kept alongside on_the_way → arrived_at_customer so
 *   the legacy direct-deliver path stays valid while the app migrates (Phase 2/3).
 *
 *   awaiting_details: a seller-board reservation hold — commits to driver_accepted
 *     (Band qilish, binding) or cancelled (fill-timer expiry / Zakazni Otmen).
 */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  created: ['assigned_to_driver', 'cancelled'],
  awaiting_details: ['driver_accepted', 'cancelled'],
  assigned_to_driver: ['driver_accepted', 'created', 'cancelled'],
  driver_accepted: ['collecting_items', 'cancelled'],
  collecting_items: ['items_collected', 'cancelled', 'returning'],
  items_collected: ['on_the_way', 'returning'],
  on_the_way: ['arrived_at_customer', 'delivered', 'returning'],
  // At the customer: deliver or start the return flow. Istisno only records a report.
  arrived_at_customer: ['delivered', 'returning'],
  returning: ['returned'],
  delivered: [],
  returned: [],
  cancelled: [],
  problem: [],
};

/** A vozvrat order has nothing to collect: once accepted, the driver heads
 *  straight to the client. Everything after that is the shared return path. */
const VOZVRAT_ORDER_EXTRA: Partial<Record<OrderStatus, readonly OrderStatus[]>> = {
  driver_accepted: ['on_the_way'],
};

export function canTransitionOrderStatus(
  from: OrderStatus,
  to: OrderStatus,
  kind: OrderKind = 'delivery',
): boolean {
  if (ORDER_STATUS_TRANSITIONS[from]?.includes(to)) return true;
  return kind === 'vozvrat' && (VOZVRAT_ORDER_EXTRA[from]?.includes(to) ?? false);
}

/** Statuses from which an order may still be cancelled (requirements §11). */
export const CANCELLABLE_ORDER_STATUSES = [
  'created',
  'assigned_to_driver',
  'driver_accepted',
  'collecting_items',
  'items_collected',
  'on_the_way',
  'arrived_at_customer',
] as const satisfies readonly OrderStatus[];

/** Statuses during which a driver may report a problem on an item. */
export const PROBLEM_REPORTABLE_ORDER_STATUSES = [
  'driver_accepted',
  'collecting_items',
  'items_collected',
  'on_the_way',
  'arrived_at_customer',
] as const satisfies readonly OrderStatus[];
