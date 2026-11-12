import {
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DriverTrack } from '@bigant/shared';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { oneDay } from './date-range';
import { longStops, trailDistanceKm } from './track-math';

const DAY_MS = 86_400_000;

/**
 * Where a truck went on a day, from the pings the location update keeps.
 * Old pings are pruned daily so the table stays the size of one month.
 */
@Injectable()
export class DriverTrackService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DriverTrackService.name);
  private readonly retentionDays: number;
  private readonly pruneEnabled: boolean;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.retentionDays = config.get('TRACK_RETENTION_DAYS', { infer: true });
    this.pruneEnabled =
      config.get('WORKER_ENABLED', { infer: true }) &&
      config.get('NODE_ENV', { infer: true }) !== 'test';
  }

  async track(driverId: string, date: string): Promise<DriverTrack> {
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      include: { user: { select: { name: true } } },
    });
    if (!driver) throw new NotFoundException('Driver not found');
    const pings = await this.prisma.driverLocationPing.findMany({
      where: { driverId, recordedAt: oneDay(date) },
      orderBy: { recordedAt: 'asc' },
      select: { lat: true, lng: true, recordedAt: true },
    });
    const points = pings.map((p) => ({ lat: p.lat, lng: p.lng, at: p.recordedAt.toISOString() }));
    return {
      driver_id: driver.id,
      driver_name: driver.user.name,
      date,
      points,
      distance_km: trailDistanceKm(points),
      first_at: points[0]?.at ?? null,
      last_at: points[points.length - 1]?.at ?? null,
      stops: longStops(points),
    };
  }

  /** Drop pings older than the retention window. */
  async prune(now: Date = new Date()): Promise<number> {
    const { count } = await this.prisma.driverLocationPing.deleteMany({
      where: { recordedAt: { lt: new Date(now.getTime() - this.retentionDays * DAY_MS) } },
    });
    return count;
  }

  onApplicationBootstrap(): void {
    if (!this.pruneEnabled) return;
    const run = () =>
      void this.prune()
        .then((n) => n > 0 && this.logger.log(`location pings pruned: ${n}`))
        .catch((err: Error) => this.logger.error('location ping prune failed', err));
    this.timer = setInterval(run, DAY_MS);
    setTimeout(run, 60_000).unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
