import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import { whenLeader } from '../common/worker-lease';
import { PoputiLateWatchService } from './poputi-late-watch.service';

/** Every three minutes: the po puti late watch (see PoputiLateWatchService). Leader only, like the other dispatchers. */
@Injectable()
export class PoputiLateWatchDispatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PoputiLateWatchDispatcher.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly enabled: boolean;
  private readonly intervalMs = 3 * 60_000;

  constructor(
    private readonly watch: PoputiLateWatchService,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('WORKER_ENABLED', { infer: true }) && config.get('NODE_ENV', { infer: true }) !== 'test';
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.logger.log('Po puti late watch disabled');
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
      const r = await this.watch.sweep();
      if (r.told.length > 0) this.logger.log(`po puti late: told ${r.told.length} seller(s)`);
    } catch (err) {
      this.logger.error('Po puti late sweep failed', err as Error);
    } finally {
      this.running = false;
    }
  }
}
