import { Module } from '@nestjs/common';
import { UploadModule } from '../upload/upload.module';
import { TelegramModule } from '../telegram/telegram.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ServiceController } from './service.controller';
import { ServiceService } from './service.service';
import { ServiceReminderDispatcher } from './service-reminder.dispatcher';
import { ReceiptReaderService } from './receipt-reader.service';

@Module({
  imports: [UploadModule, NotificationsModule, TelegramModule],
  controllers: [ServiceController],
  providers: [ServiceService, ServiceReminderDispatcher, ReceiptReaderService],
  exports: [ServiceService],
})
export class ServiceModule {}
