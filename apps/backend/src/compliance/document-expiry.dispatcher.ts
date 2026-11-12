import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ComplianceService } from './compliance.service';
import type { Env } from '../config/env.validation';
import { whenLeader } from '../common/worker-lease';

/**
 * Periodically scans vehicle + driver documents and notifies admins/managers
 * about ones that have newly expired or are about to (≤30 days). An in-process
 * poller mirroring AssignmentTimeoutDispatcher — sufficient for the MVP. The
 * sweep is idempotent per stage, so a long interval (daily by default) is fine.
 */
@Injectable()
export class DocumentExpiryDispatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DocumentExpiryDispatcher.name);
  private timer?: ReturnType<typeof setInterval>;
  private warmup?: ReturnType<typeof setTimeout>;
  private running = false;
  private readonly enabled: boolean;
  private readonly intervalMs: number;

  constructor(
    private readonly compliance: ComplianceService,
    config: ConfigService<Env, true>,
  ) {
    this.enabled =
      config.get('WORKER_ENABLED', { infer: true }) &&
      config.get('NODE_ENV', { infer: true }) !== 'test';
    this.intervalMs = config.get('DOCUMENT_EXPIRY_CHECK_INTERVAL_MS', { infer: true });
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.logger.log('Document expiry dispatcher disabled');
      return;
    }
    // Warm-up run shortly after boot so a fresh deploy surfaces alerts promptly.
    this.warmup = setTimeout(() => void this.tick(), 15_000);
    this.timer = setInterval(() => void whenLeader(() => this.tick()), this.intervalMs);
    this.logger.log(`Document expiry dispatcher polling every ${this.intervalMs}ms`);
  }

  onModuleDestroy(): void {
    if (this.warmup) {
      clearTimeout(this.warmup);
    }
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
      await this.compliance.sweepAndNotify();
    } catch (err) {
      this.logger.error(`Document expiry sweep failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
