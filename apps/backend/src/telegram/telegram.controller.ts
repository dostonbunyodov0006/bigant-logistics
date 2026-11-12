import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { TelegramService } from './telegram.service';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('telegram')
@ApiBearerAuth()
@Controller('telegram-reports')
export class TelegramController {
  constructor(private readonly telegram: TelegramService) {}

  @Roles('admin')
  @Get('failed')
  listFailed() {
    return this.telegram.listFailed();
  }

  @Roles('admin')
  @Post(':id/retry')
  retry(@Param('id') id: string) {
    return this.telegram.retry(id);
  }
}
