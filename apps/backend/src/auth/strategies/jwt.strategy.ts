import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { JwtPayload } from '@bigant/shared';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import type { Env } from '../../config/env.validation';
import { PrismaService } from '../../prisma/prisma.service';
import { isActiveAccount } from '../../common/active-account';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_ACCESS_SECRET', { infer: true }),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    // A dismissed or blocked account is out at once (owner, 06.11.2026).
    if (!(await isActiveAccount(this.prisma, payload.sub))) throw new UnauthorizedException('account_inactive');
    return { userId: payload.sub, role: payload.role };
  }
}
