import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import { whenLeader } from '../common/worker-lease';
import { OmborService } from './ombor.service';

/**
 * Every hour at a quarter past, 10:15 to 19:15 Tashkent (as the mini app
 * did): returns the warehouse has not taken in for three hours are reminded.
 */
@Injectable()
export class OmborReminderDispatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OmborReminderDispatcher.name);
  private timer?: ReturnType<typeof setInterval>;
  private readonly enabled: boolean;
  private lastHour = '';

  constructor(
    private readonly ombor: OmborService,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('WORKER_ENABLED', { infer: true }) && config.get('NODE_ENV', { infer: true }) !== 'test';
  }

  onApplicationBootstrap(): void {
    if (this.enabled) this.timer = setInterval(() => void whenLeader(() => this.tick()), 60_000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now = new Date()): Promise<void> {
    if (!reminderHour(now) || this.lastHour === reminderHour(now)) return;
    this.lastHour = reminderHour(now)!;
    try {
      const n = await this.ombor.remind(now);
      if (n) this.logger.log(`ombor reminder: ${n} returns not taken in`);
    } catch (err) {
      this.logger.error('ombor reminder failed', err as Error);
    }
  }
}

/** The Tashkent hour to remind in ("2026-11-05T10"), or null outside 10:15–19:59. */
export function reminderHour(now: Date): string | null {
  const tk = new Date(now.getTime() + 5 * 3_600_000).toISOString();
  const h = Number(tk.slice(11, 13));
  const m = Number(tk.slice(14, 16));
  return h >= 10 && h <= 19 && m >= 15 ? tk.slice(0, 13) : null;
}
