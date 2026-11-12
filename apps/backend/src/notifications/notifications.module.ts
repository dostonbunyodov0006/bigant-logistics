import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { PushSender } from './push.sender';
import { ApnsSender } from './apns.sender';
import { NotificationRetentionService } from './notification-retention.service';
import { NotificationRetentionDispatcher } from './notification-retention.dispatcher';

@Module({
  providers: [
    NotificationsService,
    PushSender,
    ApnsSender,
    NotificationRetentionService,
    NotificationRetentionDispatcher,
  ],
  controllers: [NotificationsController],
  exports: [NotificationsService],
})
export class NotificationsModule {}
