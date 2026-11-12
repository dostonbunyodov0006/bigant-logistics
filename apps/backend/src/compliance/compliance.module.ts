import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ComplianceService } from './compliance.service';
import { ComplianceController } from './compliance.controller';
import { DocumentExpiryDispatcher } from './document-expiry.dispatcher';

@Module({
  imports: [NotificationsModule],
  providers: [ComplianceService, DocumentExpiryDispatcher],
  controllers: [ComplianceController],
  exports: [ComplianceService],
})
export class ComplianceModule {}
