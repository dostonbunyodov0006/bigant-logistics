import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { tashkentMinutes, tashkentWeekday } from '../common/tashkent-time';
import { tumanAt } from './tashkent-tumans';

/** Below this much driving in an hour-of-day the figure says too little to use. */
export const MIN_SEGMENTS = 200;
export const MIN_DRIVERS = 3;
const MAX_FACTOR = 3;
const MIN_FACTOR = 0.7;
const REFRESH_MS = 60 * 60_000;

type Row = { sunday: boolean; h: number; kmh: number; n: bigint | number; drivers: bigint | number };

/**
 * How fast our own lorries really get across Tashkent, hour by hour, from the
 * last three weeks of their fixes (owner, 02.11.2026). No traffic service covers
 * Uzbekistan for free, so this corrects the map's free-road minutes instead. It
 * is one figure for the whole city per hour, not per street, and until enough
 * driving is collected it changes nothing: no data, no invented delay.
 *
 * Stops at lights count (a still fix next to a moving one); a lorry parked at a
 * client does not (a still fix among still ones).
 */
@Injectable()
export class SpeedStatsService {
  private readonly logger = new Logger(SpeedStatsService.name);
  private byHour = new Map<string, number>();
  private loadedAt = 0;
  private loading = false;

  constructor(private readonly prisma: PrismaService) {}

  /** What to multiply a city route's minutes by; 1 outside the city or without data. */
  factor(points: { lat: number; lng: number }[], km: number, seconds: number, now: Date = new Date()): number {
    if (now.getTime() - this.loadedAt > REFRESH_MS) void this.refresh(now);
    if (km <= 0 || seconds <= 0) return 1;
    if (!points.every((p) => tumanAt(p.lat, p.lng))) return 1;
    const key = hourKey(tashkentWeekday(now) === 0, Math.floor(tashkentMinutes(now) / 60));
    const real = this.byHour.get(key);
    if (!real) return 1;
    const assumed = (km / seconds) * 3600;
    return Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, assumed / real));
  }

  async refresh(now: Date = new Date()): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.loadedAt = now.getTime();
    try {
      const rows = await this.prisma.$queryRaw<Row[]>`
        with s as (
          select driver_id, recorded_at, lat, lng,
                 lag(recorded_at) over w as pt, lag(lat) over w as plat, lag(lng) over w as plng
          from driver_location_pings
          where recorded_at > ${new Date(now.getTime() - 21 * 86_400_000)}
            and lat between 41.15 and 41.45 and lng between 69.05 and 69.50
          window w as (partition by driver_id order by recorded_at)
        ), d as (
          select driver_id, recorded_at, extract(epoch from recorded_at - pt)::float8 as sec,
                 sqrt(power((lat - plat) * 110540, 2) + power((lng - plng) * 111320 * cos(radians(lat)), 2)) as m
          from s
          where pt is not null and recorded_at > pt and recorded_at - pt <= interval '3 minutes'
        ), e as (
          select *, lag(m) over w as pm, lead(m) over w as nm
          from d
          window w as (partition by driver_id order by recorded_at)
        )
        select extract(dow from recorded_at at time zone 'UTC' at time zone 'Asia/Tashkent') = 0 as sunday,
               extract(hour from recorded_at at time zone 'UTC' at time zone 'Asia/Tashkent')::int as h,
               (sum(m) / sum(sec) * 3.6)::float8 as kmh,
               count(*) as n,
               count(distinct driver_id) as drivers
        from e
        where m / sec * 3.6 <= 130 and (m >= 30 or pm >= 30 or nm >= 30)
        group by 1, 2`;
      this.byHour = hourlySpeeds(rows);
    } catch (err) {
      this.logger.warn(`speed stats failed: ${(err as Error).message}`);
    } finally {
      this.loading = false;
    }
  }
}

const hourKey = (sunday: boolean, h: number) => `${sunday ? 'sun' : 'day'}:${h}`;

/** Keeps only the hours with enough driving, by enough lorries, to mean anything. */
export function hourlySpeeds(rows: Row[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (Number(r.n) >= MIN_SEGMENTS && Number(r.drivers) >= MIN_DRIVERS && r.kmh > 0) {
      out.set(hourKey(r.sunday, r.h), r.kmh);
    }
  }
  return out;
}
