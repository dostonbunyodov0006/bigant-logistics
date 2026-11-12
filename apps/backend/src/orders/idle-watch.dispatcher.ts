import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IdleWatchService } from './idle-watch.service';
import type { Env } from '../config/env.validation';
import { whenLeader } from '../common/worker-lease';

/** Once a minute: the stalled-lorry watch (see IdleWatchService). In-process poller, like the other dispatchers. */
@Injectable()
export class IdleWatchDispatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(IdleWatchDispatcher.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly enabled: boolean;
  private readonly intervalMs = 60_000;

  constructor(
    private readonly watch: IdleWatchService,
    config: ConfigService<Env, true>,
  ) {
    this.enabled =
      config.get('WORKER_ENABLED', { infer: true }) &&
      config.get('IDLE_WATCH_ENABLED', { infer: true }) &&
      config.get('NODE_ENV', { infer: true }) !== 'test';
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.logger.log('Idle watch dispatcher disabled');
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
      const steps = await this.watch.sweep();
      const acted = Object.entries(steps).filter(([, s]) => s === 'warned' || s === 'cancelled');
      if (acted.length > 0) this.logger.log(`idle watch: ${acted.map(([id, s]) => `${id} ${s}`).join(', ')}`);
    } catch (err) {
      this.logger.error('Idle watch sweep failed', err as Error);
    } finally {
      this.running = false;
    }
  }
}
