import { Body, Controller, Get, HttpCode, Logger, Post, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

/** What a phone sends when its JavaScript dies: enough to read in the log, no more. */
const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly log = new Logger('ClientError');
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A driver's phone reporting that the app crashed.
   *
   * The phones are out of reach of any debugger, and an update that dies at
   * start-up is rolled back by the updater before anyone sees a message — so
   * the one place such a failure can be read is here, in the server log. The
   * report carries no account: it is written before the app has one, and a
   * crash is a crash whoever holds the phone.
   */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('client-error')
  @HttpCode(204)
  clientError(@Body() body: Record<string, unknown>): void {
    // Kept in the database too: the container log goes with every deploy,
    // and a report from last night was lost that way (owner, 05.11.2026).
    void this.prisma.clientReport
      .create({
        data: {
          fatal: body?.fatal === true,
          version: clip(body?.version, 20) || null,
          update: clip(body?.update, 40) || null,
          at: clip(body?.at, 40) || null,
          message: clip(body?.message, 1000) || '(none)',
          stack: clip(body?.stack, 4000) || null,
        },
      })
      .catch(() => undefined);
    this.log.error(
      [
        `fatal=${body?.fatal === true}`,
        `app=${clip(body?.version, 20) || '?'}`,
        `update=${clip(body?.update, 40) || 'apk'}`,
        `at=${clip(body?.at, 40)}`,
        `message=${clip(body?.message, 1000)}`,
        `stack=${clip(body?.stack, 4000)}`,
      ].join(' | '),
    );
  }

  /** Liveness — process is up. Does not touch the database. */
  @Public()
  @Get()
  live() {
    return { status: 'ok', service: 'logistics-backend' };
  }

  /** Readiness — dependencies (database) are reachable. */
  @Public()
  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'up' };
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'down' });
    }
  }
}
