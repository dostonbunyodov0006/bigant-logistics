import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SellerBoardService } from './seller-board.service';
import type { Env } from '../config/env.validation';
import { whenLeader } from '../common/worker-lease';

/**
 * Expires seller-board reservation holds whose fill-timer ran out, releasing the
 * slot back to the board. In-process poller (mirrors AssignmentTimeoutDispatcher).
 */
@Injectable()
export class ReservationExpiryDispatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ReservationExpiryDispatcher.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly enabled: boolean;
  private readonly intervalMs = 30_000;

  constructor(
    private readonly board: SellerBoardService,
    config: ConfigService<Env, true>,
  ) {
    this.enabled =
      config.get('WORKER_ENABLED', { infer: true }) &&
      config.get('NODE_ENV', { infer: true }) !== 'test';
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.logger.log('Reservation expiry dispatcher disabled');
      return;
    }
    this.timer = setInterval(() => void whenLeader(() => this.tick()), this.intervalMs);
    this.logger.log(`Reservation expiry dispatcher polling every ${this.intervalMs}ms`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.board.expireStale();
      if (n > 0) this.logger.log(`Expired ${n} reservation hold(s)`);
    } catch (err) {
      this.logger.error('Reservation expiry sweep failed', err as Error);
    } finally {
      this.running = false;
    }
  }
}
