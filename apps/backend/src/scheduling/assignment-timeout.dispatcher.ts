import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulingService } from './scheduling.service';
import type { Env } from '../config/env.validation';
import { whenLeader } from '../common/worker-lease';

/**
 * Periodically auto-rejects driver assignments that were never answered within
 * the timeout window, returning the order to the pool and notifying staff.
 * An in-process poller (mirrors OutboxDispatcher) — sufficient for the MVP.
 */
@Injectable()
export class AssignmentTimeoutDispatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AssignmentTimeoutDispatcher.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private readonly timeoutMinutes: number;

  constructor(
    private readonly scheduling: SchedulingService,
    config: ConfigService<Env, true>,
  ) {
    this.enabled =
      config.get('WORKER_ENABLED', { infer: true }) &&
      config.get('NODE_ENV', { infer: true }) !== 'test';
    this.intervalMs = config.get('ASSIGNMENT_TIMEOUT_POLL_INTERVAL_MS', { infer: true });
    this.timeoutMinutes = config.get('ASSIGNMENT_TIMEOUT_MINUTES', { infer: true });
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.logger.log('Assignment timeout dispatcher disabled');
      return;
    }
    this.timer = setInterval(() => void whenLeader(() => this.tick()), this.intervalMs);
    this.logger.log(
      `Assignment timeout dispatcher polling every ${this.intervalMs}ms (timeout ${this.timeoutMinutes}m)`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  private async tick(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await this.scheduling.expireStaleAssignments(this.timeoutMinutes);
    } catch (err) {
      this.logger.error(`Assignment timeout sweep failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
