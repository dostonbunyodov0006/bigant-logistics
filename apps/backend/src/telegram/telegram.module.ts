import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramSender } from './telegram.sender';
import { TelegramController } from './telegram.controller';

@Module({
  providers: [TelegramService, TelegramSender],
  controllers: [TelegramController],
  exports: [TelegramService, TelegramSender],
})
export class TelegramModule {}
