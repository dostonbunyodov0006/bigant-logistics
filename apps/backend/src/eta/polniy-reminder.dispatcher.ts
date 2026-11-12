import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PolniyReminderService } from './polniy-reminder.service';
import type { Env } from '../config/env.validation';
import { whenLeader } from '../common/worker-lease';

/** Once a minute: the "put the next order on" reminder for a Polniy with one order (see PolniyReminderService). */
@Injectable()
export class PolniyReminderDispatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PolniyReminderDispatcher.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly enabled: boolean;
  private readonly intervalMs = 60_000;

  constructor(
    private readonly reminder: PolniyReminderService,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('WORKER_ENABLED', { infer: true }) && config.get('NODE_ENV', { infer: true }) !== 'test';
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.logger.log('Polniy reminder dispatcher disabled');
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
      const steps = await this.reminder.sweep();
      const sent = Object.entries(steps).filter(([, s]) => s === 'reminded');
      if (sent.length > 0) this.logger.log(`polniy reminder: ${sent.map(([id]) => id).join(', ')}`);
    } catch (err) {
      this.logger.error('Polniy reminder sweep failed', err as Error);
    } finally {
      this.running = false;
    }
  }
}
