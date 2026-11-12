import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ShiftEndCheckService } from './shift-end-check.service';
import { LocationSilenceService } from './location-silence.service';
import type { Env } from '../config/env.validation';
import { whenLeader } from '../common/worker-lease';

/**
 * Looks every minute for shifts whose end-of-day check is due — ten minutes
 * after each driver's own shift end, then every thirty — so the 18:10 start
 * and the 30-minute rhythm are per shift, not a fixed clock. In-process
 * poller, like the other dispatchers.
 */
@Injectable()
export class ShiftEndCheckDispatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ShiftEndCheckDispatcher.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly enabled: boolean;
  private readonly intervalMs = 60_000;

  constructor(
    private readonly check: ShiftEndCheckService,
    config: ConfigService<Env, true>,
    // Kept wired for the day the push is wanted back.
    private readonly silence?: LocationSilenceService,
  ) {
    this.enabled = config.get('WORKER_ENABLED', { infer: true }) && config.get('NODE_ENV', { infer: true }) !== 'test';
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.logger.log('Shift end-check dispatcher disabled');
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
      const run = await this.check.runOnce();
      if (run.checked > 0) this.logger.log(`end check: ${run.checked} shift(s) ${JSON.stringify(run.byAction)}`);
      // The "GPS yoki internet o'chiq" push is not sent (owner, 04.11.2026): a phone
      // asleep in a pocket sends nothing either, and the driver was told his GPS
      // was off when it was not. The phone itself shows the red screen the moment
      // GPS or the internet goes; the office still sees the silences in Smena nazorati.
    } catch (err) {
      this.logger.error('Shift end-check sweep failed', err as Error);
    } finally {
      this.running = false;
    }
  }
}
