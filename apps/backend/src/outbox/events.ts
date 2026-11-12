import type { Prisma } from '@prisma/client';

/** Domain event types written to the transactional outbox. */
export const OrderEventType = {
  Assigned: 'order.assigned',
  Accepted: 'order.accepted',
  Rejected: 'order.rejected',
  AssignmentExpired: 'order.assignment_expired',
  Cancelled: 'order.cancelled',
  Problem: 'order.problem',
  StatusChanged: 'order.status_changed',
  Delivered: 'order.delivered',
  ReturnDelivered: 'order.return_delivered',
  PickupLoaded: 'order.pickup_loaded',
  // The driver wrote up what the client sent back, item by item.
  ReturnWrittenUp: 'order.return_written_up',
  // The seller moved an Ertangi order from after 09:00 to first thing.
  StartMovedEarlier: 'order.start_moved_earlier',
  // ...or from first thing to after 09:00.
  StartMovedLater: 'order.start_moved_later',
} as const;

/**
 * Append an order domain event to the outbox within the caller's transaction,
 * so the event is persisted atomically with the state change it describes.
 */
export async function emitOrderEvent(
  tx: Prisma.TransactionClient,
  eventType: string,
  orderId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.outboxEvent.create({
    data: {
      aggregateType: 'order',
      aggregateId: orderId,
      eventType,
      payload: payload as Prisma.InputJsonValue,
    },
  });
}
