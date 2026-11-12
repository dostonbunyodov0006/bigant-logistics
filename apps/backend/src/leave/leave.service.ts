import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { LeaveRequest, LeaveStatus, LeaveType } from '@prisma/client';
import type {
  GrantLeaveInput,
  LeaveRequestFilterInput,
  LeaveRequestPublic,
  ReviewLeaveRequestInput,
} from '@bigant/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const LEAVE_INCLUDE = {
  driver: { include: { user: { select: { name: true } } } },
  reviewedBy: { select: { name: true } },
};

type LeaveWithRelations = LeaveRequest & {
  driver?: { user: { name: string } } | null;
  reviewedBy?: { name: string } | null;
};

/** Parse a YYYY-MM-DD string as a UTC date. */
function toDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

/** Format a stored date back to YYYY-MM-DD (UTC). */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class LeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** The office writes a driver's leave down: he asked in person, so it is
   *  approved as entered and the driver is told what was recorded. */
  async grant(input: GrantLeaveInput, staffUserId: string): Promise<LeaveRequestPublic> {
    const driver = await this.prisma.driver.findUnique({ where: { id: input.driver_id } });
    if (!driver) {
      throw new NotFoundException('driver_not_found');
    }
    const request = await this.prisma.leaveRequest.create({
      data: {
        driverId: driver.id,
        type: input.type as LeaveType,
        startDate: toDate(input.start_date),
        endDate: toDate(input.end_date),
        reason: input.reason?.trim() || null,
        status: 'approved',
        reviewedById: staffUserId,
        reviewedAt: new Date(),
      },
      include: LEAVE_INCLUDE,
    });
    await this.notifyDriverOfGrant(request);
    return this.toPublic(request);
  }

  async listMine(userId: string): Promise<LeaveRequestPublic[]> {
    const driver = await this.prisma.driver.findUnique({ where: { userId } });
    if (!driver) {
      throw new ForbiddenException('Only a driver can perform this action');
    }
    const rows = await this.prisma.leaveRequest.findMany({
      where: { driverId: driver.id },
      include: LEAVE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toPublic(r));
  }

  async listAll(filters: LeaveRequestFilterInput): Promise<LeaveRequestPublic[]> {
    const rows = await this.prisma.leaveRequest.findMany({
      where: {
        ...(filters.status ? { status: filters.status as LeaveStatus } : {}),
        ...(filters.driver_id ? { driverId: filters.driver_id } : {}),
      },
      include: LEAVE_INCLUDE,
      // Pending first (awaiting action), then most recent.
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 500,
    });
    return rows.map((r) => this.toPublic(r));
  }

  /** Admin/manager approves or rejects a pending request. */
  async review(
    id: string,
    input: ReviewLeaveRequestInput,
    reviewerUserId: string,
  ): Promise<LeaveRequestPublic> {
    const existing = await this.prisma.leaveRequest.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('leave_request_not_found');
    }
    if (existing.status !== 'pending') {
      throw new ConflictException('leave_already_reviewed');
    }
    // Two reviewers can both pass the check above; the decision is written
    // only if the request is still pending, so the second one is told it was
    // already reviewed instead of silently overwriting the first.
    const claimed = await this.prisma.leaveRequest.updateMany({
      where: { id, status: 'pending' },
      data: {
        status: input.status as LeaveStatus,
        reviewNote: input.review_note?.trim() || null,
        reviewedById: reviewerUserId,
        reviewedAt: new Date(),
      },
    });
    if (claimed.count === 0) {
      throw new ConflictException('leave_already_reviewed');
    }
    const request = await this.prisma.leaveRequest.findUniqueOrThrow({
      where: { id },
      include: LEAVE_INCLUDE,
    });
    await this.notifyDriverOfDecision(request);
    return this.toPublic(request);
  }

  // --- Notifications ---

  private async notifyDriverOfGrant(request: LeaveWithRelations): Promise<void> {
    const driver = await this.prisma.driver.findUnique({ where: { id: request.driverId } });
    if (!driver) {
      return;
    }
    const period = `${ymd(request.startDate)} – ${ymd(request.endDate)}`;
    await this.notifications.notify(driver.userId, {
      type: 'leave.decided',
      title: "Ta'til yozildi",
      body: `${period} uchun sizga ta'til yozildi.`,
    });
  }

  private async notifyDriverOfDecision(request: LeaveWithRelations): Promise<void> {
    const driver = await this.prisma.driver.findUnique({ where: { id: request.driverId } });
    if (!driver) {
      return;
    }
    // The driver app is Uzbek-first, so this is stored/pushed in Uzbek.
    const approved = request.status === 'approved';
    const period = `${ymd(request.startDate)} – ${ymd(request.endDate)}`;
    await this.notifications.notify(driver.userId, {
      type: 'leave.decided',
      title: approved ? 'Ruxsat tasdiqlandi' : 'Ruxsat rad etildi',
      body: approved
        ? `${period} uchun ruxsatingiz tasdiqlandi.`
        : `${period} uchun ruxsatingiz rad etildi.`,
    });
  }

  // --- Helpers ---

  private toPublic(r: LeaveWithRelations): LeaveRequestPublic {
    return {
      id: r.id,
      driver_id: r.driverId,
      driver_name: r.driver?.user?.name ?? null,
      type: r.type as LeaveType,
      start_date: ymd(r.startDate),
      end_date: ymd(r.endDate),
      reason: r.reason,
      status: r.status as LeaveStatus,
      reviewed_by_id: r.reviewedById,
      reviewed_by_name: r.reviewedBy?.name ?? null,
      review_note: r.reviewNote,
      reviewed_at: r.reviewedAt ? r.reviewedAt.toISOString() : null,
      created_at: r.createdAt.toISOString(),
    };
  }
}
