import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ServiceService } from './service.service';
import type { Env } from '../config/env.validation';
import { whenLeader } from '../common/worker-lease';

/**
 * Runs the mileage reminder rule on a timer. Hourly is plenty: a reminder is
 * about kilometres, not minutes, and the rule itself (once due-soon, once
 * overdue, then weekly) makes the tick idempotent — running it more often
 * sends nothing extra. In-process poller, like the reservation expiry.
 */
@Injectable()
export class ServiceReminderDispatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ServiceReminderDispatcher.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly enabled: boolean;
  private readonly intervalMs = 60 * 60_000;

  constructor(
    private readonly service: ServiceService,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('WORKER_ENABLED', { infer: true }) && config.get('NODE_ENV', { infer: true }) !== 'test';
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.logger.log('Service reminder dispatcher disabled');
      return;
    }
    // First pass shortly after boot, then hourly.
    setTimeout(() => void this.tick(), 30_000);
    this.timer = setInterval(() => void whenLeader(() => this.tick()), this.intervalMs);
    this.logger.log('Service reminder dispatcher running hourly');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.service.sendDueReminders();
    } catch (err) {
      this.logger.error(`service reminders failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
