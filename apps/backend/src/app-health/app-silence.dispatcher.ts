import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import { whenLeader } from '../common/worker-lease';
import { AppSilenceService } from './app-silence.service';

/** Every five minutes: the driver-app silence watch (see AppSilenceService). Leader only, like the other dispatchers. */
@Injectable()
export class AppSilenceDispatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AppSilenceDispatcher.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly enabled: boolean;
  private readonly intervalMs = 5 * 60_000;

  constructor(
    private readonly watch: AppSilenceService,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('WORKER_ENABLED', { infer: true }) && config.get('NODE_ENV', { infer: true }) !== 'test';
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.logger.log('App silence dispatcher disabled');
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
      if (r.alerted.length > 0 || r.recovered.length > 0) {
        this.logger.log(`app silence: alerted ${r.alerted.length}${r.combined ? ' (combined)' : ''}, recovered ${r.recovered.length}`);
      }
    } catch (err) {
      this.logger.error('App silence sweep failed', err as Error);
    } finally {
      this.running = false;
    }
  }
}
