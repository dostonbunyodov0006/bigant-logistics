import { Global, Injectable, Logger, Module, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * One backend at a time runs the background work.
 *
 * A deploy starts the new backend beside the old one and moves the traffic
 * across before the old one stops, so the site never goes dark. For those
 * seconds two processes are up, and every dispatcher in both would tick: the
 * outbox would push the same notification twice, the shift end would pay the
 * same Viloyat trip twice. So the work goes to whoever holds a lease row in the
 * database; the newcomer waits until the old process lets go on shutdown (or
 * its lease runs out), then carries on where it left off.
 */
const LEASE_SECONDS = 45;
/** How long an answer is trusted before the row is asked again. */
const RECHECK_MS = 5_000;

let current: WorkerLeaseService | null = null;

/**
 * Run a dispatcher's tick only on the backend holding the lease. With no lease
 * service in the app (unit tests build dispatchers by hand) it simply runs.
 */
export async function whenLeader(run: () => unknown): Promise<void> {
  if (current && !(await current.isLeader())) return;
  await run();
}

@Injectable()
export class WorkerLeaseService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerLeaseService.name);
  private readonly me = randomUUID();
  private leader = false;
  private checkedAt = 0;
  private pending: Promise<boolean> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    // The dispatchers reach the lease through whenLeader(), without injecting
    // it: twelve constructors left as they were. One instance per process.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    current = this;
  }

  async isLeader(): Promise<boolean> {
    if (Date.now() - this.checkedAt < RECHECK_MS) return this.leader;
    // Twelve dispatchers may ask in the same instant; one query answers them all.
    this.pending ??= this.claim().finally(() => (this.pending = null));
    return this.pending;
  }

  private async claim(): Promise<boolean> {
    try {
      const rows = await this.prisma.$queryRaw<{ holder: string }[]>`
        INSERT INTO worker_lease (id, holder, expires_at)
        VALUES ('main', ${this.me}, now() + make_interval(secs => ${LEASE_SECONDS}))
        ON CONFLICT (id) DO UPDATE SET holder = EXCLUDED.holder, expires_at = EXCLUDED.expires_at
        WHERE worker_lease.holder = EXCLUDED.holder OR worker_lease.expires_at < now()
        RETURNING holder`;
      const now = rows.length > 0;
      if (now !== this.leader) this.logger.log(now ? 'background work: this backend took the lease' : 'background work: lease held elsewhere');
      this.leader = now;
    } catch (err) {
      // No answer from the database: do not run, rather than run twice.
      this.logger.warn(`worker lease check failed: ${(err as Error).message}`);
      this.leader = false;
    }
    this.checkedAt = Date.now();
    return this.leader;
  }

  /** Let go at once on a deploy, so the new backend need not wait the lease out. */
  async onApplicationShutdown(): Promise<void> {
    if (current === this) current = null;
    if (!this.leader) return;
    try {
      await this.prisma.$executeRaw`UPDATE worker_lease SET expires_at = now() WHERE id = 'main' AND holder = ${this.me}`;
    } catch {
      // The lease runs out by itself within LEASE_SECONDS.
    }
  }
}

@Global()
@Module({ providers: [WorkerLeaseService], exports: [WorkerLeaseService] })
export class WorkerLeaseModule {}
