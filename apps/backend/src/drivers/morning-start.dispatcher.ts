import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MorningStartService } from './morning-start.service';
import type { Env } from '../config/env.validation';
import { whenLeader } from '../common/worker-lease';

/**
 * Looks every minute at the morning presses still waiting for the lorry to
 * move, and confirms them from the GPS trail. In-process poller, like the
 * other dispatchers.
 */
@Injectable()
export class MorningStartDispatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MorningStartDispatcher.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly enabled: boolean;
  private readonly intervalMs = 60_000;

  constructor(
    private readonly mornings: MorningStartService,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('WORKER_ENABLED', { infer: true }) && config.get('NODE_ENV', { infer: true }) !== 'test';
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.logger.log('Morning start dispatcher disabled');
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
      const tally = await this.mornings.runOnce();
      if (tally.confirmed + tally.no_move > 0) this.logger.log(`morning starts: ${JSON.stringify(tally)}`);
    } catch (err) {
      this.logger.error('Morning start sweep failed', err as Error);
    } finally {
      this.running = false;
    }
  }
}
