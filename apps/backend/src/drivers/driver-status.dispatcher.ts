import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DriversService } from './drivers.service';
import type { Env } from '../config/env.validation';
import { whenLeader } from '../common/worker-lease';

/**
 * Once a minute: a driver on shift whose Ertangi booking has opened (00:01 on
 * its day) becomes busy. Nothing else happens at 00:01 — no request arrives —
 * so without this he stayed Bo'sh until he tapped his first pickup.
 * In-process poller, like the other dispatchers.
 */
@Injectable()
export class DriverStatusDispatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DriverStatusDispatcher.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly enabled: boolean;
  private readonly intervalMs = 60_000;

  constructor(
    private readonly drivers: DriversService,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('WORKER_ENABLED', { infer: true }) && config.get('NODE_ENV', { infer: true }) !== 'test';
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.logger.log('Driver status dispatcher disabled');
      return;
    }
    this.timer = setInterval(() => void whenLeader(() => this.tick()), this.intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.drivers.settleOpenedBookings();
      if (n > 0) this.logger.log(`${n} driver(s) busy with a booking that opened`);
    } catch (err) {
      this.logger.error('Driver status sweep failed', err as Error);
    } finally {
      this.running = false;
    }
  }
}
