import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AppUpdatesService } from './app-updates.service';

@ApiTags('app-updates')
@ApiBearerAuth()
@Controller('app-updates')
export class AppUpdatesController {
  constructor(private readonly updates: AppUpdatesService) {}

  /** Whether this account's phone takes test updates before everyone else (owner, 09.11.2026). */
  @Get('channel')
  channel(@CurrentUser('userId') userId: string): { tester: boolean } {
    return { tester: this.updates.isTester(userId) };
  }
}
