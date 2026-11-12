import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import { whenLeader } from '../common/worker-lease';
import { BreakReminderService } from './break-reminder.service';

/** Every minute: the "break is ending" reminder (see BreakReminderService). Leader only. */
@Injectable()
export class BreakReminderDispatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BreakReminderDispatcher.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly enabled: boolean;

  constructor(
    private readonly reminder: BreakReminderService,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('WORKER_ENABLED', { infer: true }) && config.get('NODE_ENV', { infer: true }) !== 'test';
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) return;
    this.timer = setInterval(() => void whenLeader(() => this.tick()), 60_000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const r = await this.reminder.sweep();
      if (r.told > 0) this.logger.log(`break ending: told ${r.told} driver(s)`);
    } catch (err) {
      this.logger.error('Break reminder sweep failed', err as Error);
    } finally {
      this.running = false;
    }
  }
}
