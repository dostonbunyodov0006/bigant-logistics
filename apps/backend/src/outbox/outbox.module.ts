import { Module } from '@nestjs/common';
import { OutboxDispatcher } from './outbox.dispatcher';
import { QueueRetentionService } from './queue-retention.service';
import { QueueRetentionDispatcher } from './queue-retention.dispatcher';
import { NotificationsModule } from '../notifications/notifications.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [NotificationsModule, TelegramModule],
  providers: [OutboxDispatcher, QueueRetentionService, QueueRetentionDispatcher],
})
export class OutboxModule {}
