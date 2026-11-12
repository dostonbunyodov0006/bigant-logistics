import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { JwtPayload } from '@bigant/shared';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { isActiveAccount } from '../common/active-account';

/** Auth for the SSE stream. EventSource can't send an Authorization header, so the
 *  access token arrives as `?token=…`; we verify it and attach `req.user` for
 *  `@CurrentUser()`. (Token-in-query can surface in access logs — acceptable for an
 *  internal tool; swap for a short-lived stream ticket if that becomes a concern.) */
@Injectable()
export class SseQueryTokenGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{ query?: { token?: string }; user?: unknown }>();
    const token = req.query?.token;
    if (!token || typeof token !== 'string') {
      throw new UnauthorizedException('missing_token');
    }
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      });
    } catch {
      throw new UnauthorizedException('invalid_token');
    }
    // A dismissed account is out of the stream too, as jwt.strategy does (audit, 07.11.2026).
    if (!(await isActiveAccount(this.prisma, payload.sub))) throw new UnauthorizedException('account_inactive');
    req.user = { userId: payload.sub, role: payload.role };
    return true;
  }
}
