import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EveningOvertimeService } from './evening-overtime.service';
import type { Env } from '../config/env.validation';
import { whenLeader } from '../common/worker-lease';

/**
 * Looks every minute for shifts just closed, and pays their minutes past the
 * end of the working day. In-process poller, like the other dispatchers.
 */
@Injectable()
export class EveningOvertimeDispatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(EveningOvertimeDispatcher.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly enabled: boolean;
  private readonly intervalMs = 60_000;

  constructor(
    private readonly evenings: EveningOvertimeService,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('WORKER_ENABLED', { infer: true }) && config.get('NODE_ENV', { infer: true }) !== 'test';
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.logger.log('Evening overtime dispatcher disabled');
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
      const tally = await this.evenings.runOnce();
      if (tally.paid > 0) this.logger.log(`evening overtime: ${JSON.stringify(tally)}`);
    } catch (err) {
      this.logger.error('Evening overtime sweep failed', err as Error);
    } finally {
      this.running = false;
    }
  }
}
