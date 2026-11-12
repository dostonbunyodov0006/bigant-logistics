import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DriverAssignment } from '@prisma/client';
import {
  BLOCKING_ACTIVE_ORDER_STATUSES,
  type AssignmentPublic,
  type AssignmentStatus,
  type AssignDriverResult,
  type ConflictWarning,
  type Role,
} from '@bigant/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { closeBreakForWork, ordersInHand, settleDriverStatus } from '../drivers/driver-status';
import { emitOrderEvent, OrderEventType } from '../outbox/events';
import type { Env } from '../config/env.validation';

type Actor = { userId: string; role: Role };

/** Assignment statuses that occupy a slot in a driver's schedule. */
const ACTIVE_ASSIGNMENT_STATUSES: AssignmentStatus[] = ['pending_driver_response', 'accepted'];
/** Order statuses from which a driver can be (re)assigned. */
const REASSIGNABLE_ORDER_STATUSES = ['assigned_to_driver', 'driver_accepted', 'problem'];
/** Finished work is never moved to someone else. */
const TERMINAL_FOR_REASSIGN = ['delivered', 'returned', 'cancelled'];

/** Only the office may take a journey off a driver who is not coming. */
const isStaff = (a: Actor) => a.role === 'admin' || a.role === 'manager';

@Injectable()
export class SchedulingService {
  private readonly logger = new Logger(SchedulingService.name);
  private readonly windowMinutes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    config: ConfigService<Env, true>,
  ) {
    this.windowMinutes = config.get('SCHEDULE_CONFLICT_WINDOW_MINUTES', { infer: true });
  }

  /**
   * Is the assigned driver away — off shift, or without one today? That is the
   * case where a journey has to be able to change hands: the goods are in a
   * van nobody is driving.
   */
  private async driverIsAway(assignedDriverId: string | null): Promise<boolean> {
    if (!assignedDriverId) return true;
    const open = await this.prisma.workLog.count({
      where: { driverId: assignedDriverId, clockOutAt: null },
    });
    return open === 0;
  }

  /** FR-006/007: assign (or reassign) a driver to an order; never blocks on conflicts. */
  async assign(
    orderId: string,
    driverId: string,
    actor: Actor,
    opts: { binding?: boolean } = {},
  ): Promise<AssignDriverResult> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (actor.role === 'seller' && order.createdBySellerId !== actor.userId) {
      throw new ForbiddenException('Not your order');
    }
    const driver = await this.prisma.driver.findUnique({ where: { id: driverId } });
    if (!driver) {
      throw new NotFoundException('Driver not found');
    }

    const isInitial = order.status === 'created';
    let isReassign = REASSIGNABLE_ORDER_STATUSES.includes(order.status);
    // A journey already under way belongs to the driver on it — except when
    // he is not coming: an order carried over to today whose driver never
    // clocked in was unreachable, because every action on it asks for that
    // driver and nobody could hand it to another. Staff may move it then, and
    // the new driver picks it up exactly where it stands.
    if (!isInitial && !isReassign && isStaff(actor) && !TERMINAL_FOR_REASSIGN.includes(order.status)) {
      const stranded = await this.driverIsAway(order.assignedDriverId);
      if (stranded) isReassign = true;
    }
    if (!isInitial && !isReassign) {
      throw new ConflictException('order_already_in_progress');
    }

    // Non-blocking prebooking conflict warnings (BR-007).
    const warnings = await this.computeConflicts(driverId, order.deliveryDatetime, order.id);

    const oldDriverId = isReassign ? order.assignedDriverId : null;
    // A binding assignment is the seller board's way: the lorry is his from
    // this moment, as if he had accepted. Only a fresh order can be bound.
    const binding = !!opts.binding && isInitial;
    const status = binding ? 'driver_accepted' : 'assigned_to_driver';

    let settled: string | null = null;
    const assignment = await this.prisma.$transaction(async (tx) => {
      // Claimed as it was read: the driver accepting or starting meanwhile used
      // to be overwritten back to assigned (audit, 07.11.2026).
      const claim = await tx.order.updateMany({
        where: { id: order.id, status: order.status, assignedDriverId: order.assignedDriverId },
        // A new driver starts the stalled-lorry watch afresh.
        data: { assignedDriverId: driverId, status, idleWatchSince: null, idleStartMetres: null, idleState: null },
      });
      if (claim.count === 0) throw new ConflictException('order_already_in_progress');
      if (isReassign) {
        await tx.driverAssignment.updateMany({
          where: { orderId: order.id, assignmentStatus: { in: ACTIVE_ASSIGNMENT_STATUSES } },
          data: { assignmentStatus: 'cancelled' },
        });
      }
      const created = await tx.driverAssignment.create({
        data: {
          orderId: order.id,
          driverId,
          deliveryDatetime: order.deliveryDatetime,
          createdById: actor.userId,
          ...(binding ? { assignmentStatus: 'accepted' as const } : {}),
        },
      });
      // The order has left the old driver; what he is left with decides his
      // status — and a driver who had clocked out stays off.
      if (oldDriverId && oldDriverId !== driverId) await settleDriverStatus(tx, oldDriverId);
      await emitOrderEvent(tx, OrderEventType.Assigned, order.id, { orderId: order.id, driverId });
      if (binding) {
        // Everything an accept would have done: the break ends, his status settles.
        await closeBreakForWork(tx, driverId);
        settled = (await settleDriverStatus(tx, driverId)).status;
        await emitOrderEvent(tx, OrderEventType.Accepted, order.id, { orderId: order.id, driverId });
      }
      return created;
    });

    this.realtime.orderStatusChanged(order.id, status, driverId);
    if (settled) this.realtime.driverStatusChanged(driverId, settled);
    if (oldDriverId && oldDriverId !== driverId) this.realtime.driverStatusChanged(oldDriverId);
    return { assignment: this.toPublic(assignment), warnings };
  }

  /** Preview conflicts for the UI before assigning (FR-005/007). */
  async previewConflicts(driverId: string, deliveryDatetime: string): Promise<ConflictWarning[]> {
    return this.computeConflicts(driverId, new Date(deliveryDatetime));
  }

  /** FR-008: the assigned driver accepts the order. */
  async accept(assignmentId: string, actor: Actor): Promise<AssignmentPublic> {
    const { assignment, driverId } = await this.loadOwnAssignment(assignmentId, actor);
    await this.assertOnShift(driverId);
    if (assignment.assignmentStatus !== 'pending_driver_response') {
      throw new ConflictException('assignment_not_pending');
    }
    // An Ertangi booking that has not opened yet is not work in hand — it must
    // not stop him taking today's order.
    const inHand = await ordersInHand(this.prisma, driverId, BLOCKING_ACTIVE_ORDER_STATUSES, {
      exceptOrderId: assignment.orderId,
    });
    if (inHand.length > 0) {
      throw new ConflictException('driver_has_active_order');
    }
    // What he is after accepting, as the settler worked it out.
    let settled: string = 'busy';
    const updated = await this.prisma.$transaction(async (tx) => {
      // Conditional on the status in the same statement: a double tap, or an
      // accept racing the timeout sweep, finds nothing to update and stops here.
      const { count } = await tx.driverAssignment.updateMany({
        where: { id: assignmentId, assignmentStatus: 'pending_driver_response' },
        data: { assignmentStatus: 'accepted' },
      });
      if (count === 0) throw new ConflictException('assignment_not_pending');
      const a = await tx.driverAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
      // The write is conditional, so its result is the answer: if the order
      // moved on while the driver was tapping — cancelled, or handed to
      // someone else — the accept fails here, instead of marking him busy
      // with nothing aboard and leaving an order on his screen with no button.
      const moved = await tx.order.updateMany({
        where: { id: assignment.orderId, status: 'assigned_to_driver', assignedDriverId: driverId },
        data: { status: 'driver_accepted' },
      });
      if (moved.count === 0) throw new ConflictException('order_already_in_progress');
      // He is driving now, so a break that was running is over.
      await closeBreakForWork(tx, driverId);
      // Through the settler, so a driver who has clocked out is not brought
      // back online by accepting, and a co-loaded second order is accounted for.
      settled = (await settleDriverStatus(tx, driverId)).status;
      await emitOrderEvent(tx, OrderEventType.Accepted, assignment.orderId, {
        orderId: assignment.orderId,
        driverId,
      });
      return a;
    });
    this.realtime.orderStatusChanged(assignment.orderId, 'driver_accepted', driverId);
    this.realtime.driverStatusChanged(driverId, settled);
    return this.toPublic(updated);
  }

  /** FR-008: the assigned driver rejects; the order returns to the pool. */
  async reject(assignmentId: string, actor: Actor): Promise<AssignmentPublic> {
    const { assignment, driverId } = await this.loadOwnAssignment(assignmentId, actor);
    await this.assertOnShift(driverId);
    if (assignment.assignmentStatus !== 'pending_driver_response') {
      throw new ConflictException('assignment_not_pending');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.driverAssignment.updateMany({
        where: { id: assignmentId, assignmentStatus: 'pending_driver_response' },
        data: { assignmentStatus: 'rejected' },
      });
      if (count === 0) throw new ConflictException('assignment_not_pending');
      const a = await tx.driverAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
      await tx.order.updateMany({
        where: { id: assignment.orderId, status: 'assigned_to_driver', assignedDriverId: driverId },
        data: { status: 'created', assignedDriverId: null },
      });
      await settleDriverStatus(tx, driverId);
      await emitOrderEvent(tx, OrderEventType.Rejected, assignment.orderId, {
        orderId: assignment.orderId,
      });
      return a;
    });
    this.realtime.orderStatusChanged(assignment.orderId, 'created', driverId);
    this.realtime.driverStatusChanged(driverId);
    return this.toPublic(updated);
  }

  /**
   * Auto-reject assignments left unanswered past the timeout window: the order
   * returns to the pool and the seller/admin are notified (decision: 10-min timeout).
   * Runs from a background poller. Returns the number of assignments expired.
   */
  async expireStaleAssignments(timeoutMinutes: number): Promise<number> {
    const cutoff = new Date(Date.now() - timeoutMinutes * 60_000);
    const stale = await this.prisma.driverAssignment.findMany({
      where: { assignmentStatus: 'pending_driver_response', createdAt: { lt: cutoff } },
      select: { id: true, orderId: true, driverId: true },
    });

    let expired = 0;
    for (const a of stale) {
      try {
        const didExpire = await this.prisma.$transaction(async (tx) => {
          // Re-check inside the transaction to avoid racing a just-in-time accept/reject.
          const fresh = await tx.driverAssignment.findUnique({ where: { id: a.id } });
          if (!fresh || fresh.assignmentStatus !== 'pending_driver_response') {
            return false;
          }
          await tx.driverAssignment.update({
            where: { id: a.id },
            data: { assignmentStatus: 'rejected' },
          });
          // Only release the order if it is still pending this driver's response.
          const { count } = await tx.order.updateMany({
            where: { id: a.orderId, status: 'assigned_to_driver', assignedDriverId: a.driverId },
            data: { status: 'created', assignedDriverId: null },
          });
          if (count === 0) {
            return false;
          }
          // An offer he never answered changes nothing he was doing; an
          // off-shift driver stays off.
          await settleDriverStatus(tx, a.driverId);
          await emitOrderEvent(tx, OrderEventType.AssignmentExpired, a.orderId, {
            orderId: a.orderId,
            driverId: a.driverId,
          });
          return true;
        });
        if (didExpire) {
          expired++;
          this.realtime.orderStatusChanged(a.orderId, 'created', a.driverId);
          this.realtime.driverStatusChanged(a.driverId);
        }
      } catch (err) {
        this.logger.error(`Failed to expire stale assignment ${a.id}: ${(err as Error).message}`);
      }
    }
    if (expired > 0) {
      this.logger.log(`Expired ${expired} stale assignment(s) past ${timeoutMinutes}m timeout`);
    }
    return expired;
  }

  /** The driver's own assignments (for the mobile accept/reject + upcoming view). */
  async listMine(actor: Actor): Promise<AssignmentPublic[]> {
    const driverId = await this.resolveDriverId(actor);
    const assignments = await this.prisma.driverAssignment.findMany({
      where: { driverId },
      orderBy: { deliveryDatetime: 'asc' },
    });
    return assignments.map((a) => this.toPublic(a));
  }

  /** FR-005: driver availability — status plus current/upcoming assignments. */
  async availability() {
    const drivers = await this.prisma.driver.findMany({
      where: { user: { status: 'active' } },
      include: {
        user: true,
        assignments: {
          where: { assignmentStatus: { in: ACTIVE_ASSIGNMENT_STATUSES } },
          orderBy: { deliveryDatetime: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return drivers.map((d) => ({
      driver_id: d.id,
      name: d.user.name,
      phone_number: d.user.phoneNumber,
      current_status: d.currentStatus,
      assignments: d.assignments.map((a) => this.toPublic(a)),
    }));
  }

  private async computeConflicts(
    driverId: string,
    deliveryDatetime: Date,
    excludeOrderId?: string,
  ): Promise<ConflictWarning[]> {
    const windowMs = this.windowMinutes * 60_000;
    const from = new Date(deliveryDatetime.getTime() - windowMs);
    const to = new Date(deliveryDatetime.getTime() + windowMs);
    const clashes = await this.prisma.driverAssignment.findMany({
      where: {
        driverId,
        assignmentStatus: { in: ACTIVE_ASSIGNMENT_STATUSES },
        deliveryDatetime: { gte: from, lte: to },
        ...(excludeOrderId ? { orderId: { not: excludeOrderId } } : {}),
      },
      include: { order: { select: { orderNumber: true, clientName: true } } },
      orderBy: { deliveryDatetime: 'asc' },
    });
    return clashes.map((c) => ({
      assignment_id: c.id,
      order_id: c.orderId,
      order_number: c.order.orderNumber,
      client_name: c.order.clientName,
      delivery_datetime: c.deliveryDatetime.toISOString(),
      message: `Driver already has the order for ${c.order.clientName} within ${this.windowMinutes} minutes of this delivery time`,
    }));
  }

  private async loadOwnAssignment(assignmentId: string, actor: Actor) {
    const driverId = await this.resolveDriverId(actor);
    const assignment = await this.prisma.driverAssignment.findUnique({
      where: { id: assignmentId },
    });
    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }
    if (assignment.driverId !== driverId) {
      throw new ForbiddenException('Assignment does not belong to you');
    }
    return { assignment, driverId };
  }

  /** Off shift he may read an offer, not answer it — as with every press on an order. */
  private async assertOnShift(driverId: string): Promise<void> {
    const open = await this.prisma.workLog.count({ where: { driverId, clockOutAt: null } });
    if (open === 0) throw new ConflictException('shift_not_started');
  }

  private async resolveDriverId(actor: Actor): Promise<string> {
    const driver = await this.prisma.driver.findUnique({ where: { userId: actor.userId } });
    if (!driver) {
      throw new ForbiddenException('Only a driver can perform this action');
    }
    return driver.id;
  }

  private toPublic(a: DriverAssignment): AssignmentPublic {
    return {
      id: a.id,
      order_id: a.orderId,
      driver_id: a.driverId,
      delivery_datetime: a.deliveryDatetime.toISOString(),
      assignment_status: a.assignmentStatus as AssignmentStatus,
      start_time: a.startTime ? a.startTime.toISOString() : null,
      estimated_finish_time: a.estimatedFinishTime ? a.estimatedFinishTime.toISOString() : null,
      created_by: a.createdById,
      created_at: a.createdAt.toISOString(),
      updated_at: a.updatedAt.toISOString(),
    };
  }
}
