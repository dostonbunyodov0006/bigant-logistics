import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VozvratReportService } from './vozvrat-report.service';
import type { Env } from '../config/env.validation';
import { whenLeader } from '../common/worker-lease';

/**
 * Retries vozvrat reports the accounting system did not take the first time.
 * In-process poller, like the other dispatchers.
 */
@Injectable()
export class VozvratReportDispatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(VozvratReportDispatcher.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly enabled: boolean;
  private readonly intervalMs = 60_000;

  constructor(
    private readonly reports: VozvratReportService,
    config: ConfigService<Env, true>,
  ) {
    this.enabled =
      config.get('WORKER_ENABLED', { infer: true }) &&
      config.get('NODE_ENV', { infer: true }) !== 'test';
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.logger.log('Vozvrat report dispatcher disabled');
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
      const n = await this.reports.runDue();
      if (n > 0) this.logger.log(`vozvrat reports retried: ${n}`);
    } catch (err) {
      this.logger.error('Vozvrat report sweep failed', err as Error);
    } finally {
      this.running = false;
    }
  }
}
