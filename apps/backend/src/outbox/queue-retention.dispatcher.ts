import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueueRetentionService } from './queue-retention.service';
import type { Env } from '../config/env.validation';
import { whenLeader } from '../common/worker-lease';

/** Prunes the queue tables daily. Retention is measured in months, so the exact
 *  moment a row disappears does not matter — only that the tables stay bounded. */
@Injectable()
export class QueueRetentionDispatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(QueueRetentionDispatcher.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly enabled: boolean;
  private readonly intervalMs = 24 * 3_600_000;

  constructor(
    private readonly retention: QueueRetentionService,
    config: ConfigService<Env, true>,
  ) {
    this.enabled =
      config.get('WORKER_ENABLED', { infer: true }) &&
      config.get('NODE_ENV', { infer: true }) !== 'test';
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.logger.log('Queue retention dispatcher disabled');
      return;
    }
    void this.tick();
    this.timer = setInterval(() => void whenLeader(() => this.tick()), this.intervalMs);
    this.logger.log('Queue retention sweeping daily');
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
      this.logger.error('Queue retention sweep failed', err as Error);
    } finally {
      this.running = false;
    }
  }
}
