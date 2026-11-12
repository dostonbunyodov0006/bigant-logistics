import { Body, Controller, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  loginSchema,
  refreshSchema,
  type LoginInput,
  type RefreshInput,
} from '@bigant/shared';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  // Phone numbers are guessable and a password is short: 20 tries a minute
  // from one address is plenty for people and useless for a dictionary.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Public()
  @HttpCode(200)
  @Post('login')
  login(@Body(new ZodValidationPipe(loginSchema)) body: LoginInput, @Headers('x-bigant-client') client?: string) {
    return this.auth.login(body, client === 'web' ? 'web' : 'app');
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Public()
  @HttpCode(200)
  @Post('refresh')
  refresh(@Body(new ZodValidationPipe(refreshSchema)) body: RefreshInput) {
    return this.auth.refresh(body.refresh_token);
  }

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser('userId') userId: string) {
    return this.users.getPublicById(userId);
  }
}
