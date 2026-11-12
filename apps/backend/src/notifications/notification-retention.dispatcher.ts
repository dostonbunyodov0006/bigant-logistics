import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationRetentionService } from './notification-retention.service';
import type { Env } from '../config/env.validation';
import { whenLeader } from '../common/worker-lease';

/**
 * Prunes expired notifications on a slow timer. Retention is measured in days,
 * so hourly is plenty — the point is that the table stays bounded, not that a
 * row disappears the instant it expires.
 */
@Injectable()
export class NotificationRetentionDispatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(NotificationRetentionDispatcher.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly enabled: boolean;
  private readonly intervalMs = 3_600_000; // 1 hour

  constructor(
    private readonly retention: NotificationRetentionService,
    config: ConfigService<Env, true>,
  ) {
    this.enabled =
      config.get('WORKER_ENABLED', { infer: true }) &&
      config.get('NODE_ENV', { infer: true }) !== 'test';
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.logger.log('Notification retention dispatcher disabled');
      return;
    }
    // Sweep once at boot so a long-stopped instance catches up immediately.
    void this.tick();
    this.timer = setInterval(() => void whenLeader(() => this.tick()), this.intervalMs);
    this.logger.log(`Notification retention sweeping every ${this.intervalMs}ms`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.retention.sweep();
    } catch (err) {
      this.logger.error('Notification retention sweep failed', err as Error);
    } finally {
      this.running = false;
    }
  }
}
