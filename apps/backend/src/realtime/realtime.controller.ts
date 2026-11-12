import { Controller, Sse, UseGuards, type MessageEvent } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { filter, from, interval, map, merge, switchMap, takeUntil, type Observable } from 'rxjs';
import type { RealtimeEvent } from '@bigant/shared';
import { RealtimeService, canSeeRealtimeEvent } from './realtime.service';
import { SseQueryTokenGuard } from './sse-query-token.guard';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { isActiveAccount } from '../common/active-account';

const PING_INTERVAL_MS = 25_000;

@ApiTags('realtime')
@Controller('realtime')
export class RealtimeController {
  constructor(
    private readonly realtime: RealtimeService,
    private readonly prisma: PrismaService,
  ) {}

  /** Server-Sent-Events stream of live board events, filtered per subscriber.
   *  Auth via `?token=` (see SseQueryTokenGuard); `@Public()` bypasses the global
   *  header-based JwtAuthGuard so our query-token guard can run instead. */
  @Public()
  @UseGuards(SseQueryTokenGuard)
  @Sse('stream')
  stream(@CurrentUser() user: AuthenticatedUser): Observable<MessageEvent> {
    const ping$ = interval(PING_INTERVAL_MS).pipe(
      map(
        (): RealtimeEvent => ({
          type: 'ping',
          order_id: null,
          driver_id: null,
          status: null,
          at: new Date().toISOString(),
        }),
      ),
    );
    const toMessage = (event: RealtimeEvent): MessageEvent => ({ data: event });
    // The stream was checked once when it opened; a dismissed seller kept
    // seeing every order (06.11.2026). Looked at again every minute.
    const dismissed$ = interval(60_000).pipe(
      switchMap(() => from(isActiveAccount(this.prisma, user.userId))),
      filter((active) => !active),
    );

    if (user.role === 'driver') {
      // Resolve the driver's id once, then only pass their own events.
      return from(this.realtime.resolveDriverId(user.userId)).pipe(
        switchMap((driverId) =>
          merge(this.realtime.stream(), ping$).pipe(
            filter((e) => canSeeRealtimeEvent('driver', driverId, e)),
            map(toMessage),
          ),
        ),
        takeUntil(dismissed$),
      );
    }

    return merge(this.realtime.stream(), ping$).pipe(
      filter((e) => canSeeRealtimeEvent(user.role, null, e)),
      map(toMessage),
      takeUntil(dismissed$),
    );
  }
}
