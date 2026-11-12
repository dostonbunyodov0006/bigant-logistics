import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';

/** A bcrypt hash of nothing anyone can type, cost 10 like the real ones. */
const DUMMY_HASH = '$2a$10$zUKeRgVxH6rWTuKFNHwZweEzod71p9N3e/fWeqFuBPvKfJOyuiqFS';
import type { AuthTokens, JwtPayload, LoginInput } from '@bigant/shared';
import { UsersService } from '../users/users.service';
import type { Env } from '../config/env.validation';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * `client` is what the caller says it is ('web' from the dashboard, else the
   * app). Drivers work in the app only; the dashboard has nothing for them,
   * so a driver's login from it is refused here rather than only on the page.
   */
  async login(input: LoginInput, client: 'web' | 'app' = 'app'): Promise<AuthTokens> {
    const user = await this.validateUser(input.phone_number, input.password);
    if (client === 'web' && user.role === 'driver') {
      throw new ForbiddenException('driver_not_allowed_web');
    }
    return this.issueTokens({ sub: user.id, role: user.role });
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    // Re-read the account: a blocked or deleted user must not keep minting tokens
    // for the rest of the refresh TTL, and a role change takes effect here.
    const user = await this.users.findById(payload.sub);
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('Invalid refresh token');
    }
    return this.issueTokens({ sub: user.id, role: user.role });
  }

  private async validateUser(phoneNumber: string, password: string) {
    const user = await this.users.findByPhone(phoneNumber);
    if (!user || user.status !== 'active') {
      // The same work as a real check (06.11.2026): answering at once told a
      // guesser which phone numbers have an account.
      await bcrypt.compare(password, DUMMY_HASH);
      throw new UnauthorizedException('Invalid credentials');
    }
    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return user;
  }

  private async issueTokens(payload: JwtPayload): Promise<AuthTokens> {
    const [access_token, refresh_token] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
        expiresIn: this.config.get('JWT_ACCESS_TTL', { infer: true }),
      }),
      this.jwt.signAsync(payload, {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
        expiresIn: this.config.get('JWT_REFRESH_TTL', { infer: true }),
      }),
    ]);
    return { access_token, refresh_token };
  }
}
