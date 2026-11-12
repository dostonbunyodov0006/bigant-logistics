import { Module } from '@nestjs/common';
import { PoputiService } from './poputi.service';
import { RoutingModule } from '../routing/routing.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PoputiLateWatchService } from './poputi-late-watch.service';
import { PoputiLateWatchDispatcher } from './poputi-late-watch.dispatcher';

@Module({
  imports: [RoutingModule, NotificationsModule],
  providers: [PoputiService, PoputiLateWatchService, PoputiLateWatchDispatcher],
  exports: [PoputiService],
})
export class PoputiModule {}
