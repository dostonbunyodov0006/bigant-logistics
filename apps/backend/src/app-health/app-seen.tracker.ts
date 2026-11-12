import { Injectable, Logger, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

/** One write per driver per minute at most: the app asks every few seconds. */
export const APP_SEEN_WRITE_EVERY_MS = 60_000;

/**
 * Remembers when the driver app itself last reached the server (owner,
 * 09.11.2026). Only a request signed in as a driver counts — the phone's own
 * location service sends with its location key, no login, and kept sending
 * while a bad app update had stopped the app from asking anything at all.
 */
@Injectable()
export class AppSeenTracker {
  private readonly logger = new Logger(AppSeenTracker.name);
  /** userId -> when we last wrote for him (ms). One row per driver, so small. */
  private readonly lastWrite = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  /** Fire and forget: never awaited by the request, never throws. */
  seen(userId: string, now = Date.now()): void {
    const last = this.lastWrite.get(userId);
    if (last !== undefined && now - last < APP_SEEN_WRITE_EVERY_MS) return;
    this.lastWrite.set(userId, now);
    // Raw, so the driver's updated_at (his profile changed) is left alone.
    this.prisma.$executeRaw`UPDATE drivers SET last_app_seen_at = ${new Date(now)} WHERE user_id = ${userId}`.catch(
      (err: unknown) => this.logger.warn(`last_app_seen_at not written: ${(err as Error).message}`),
    );
  }
}

/** Global: every HTTP request that reaches a handler signed in as a driver. */
@Injectable()
export class AppSeenInterceptor implements NestInterceptor {
  constructor(private readonly tracker: AppSeenTracker) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') {
      const user = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
      if (user?.role === 'driver' && user.userId) this.tracker.seen(user.userId);
    }
    return next.handle();
  }
}
