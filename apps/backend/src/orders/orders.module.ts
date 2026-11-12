import { Module } from '@nestjs/common';
import { VozvratModule } from '../vozvrat/vozvrat.module';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { BonusModule } from '../bonus/bonus.module';
import { ClientsModule } from '../clients/clients.module';
import { DriversModule } from '../drivers/drivers.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { IdleWatchService } from './idle-watch.service';
import { IdleWatchDispatcher } from './idle-watch.dispatcher';

@Module({
  imports: [BonusModule, VozvratModule, ClientsModule, NotificationsModule, DriversModule],
  providers: [OrdersService, IdleWatchService, IdleWatchDispatcher],
  controllers: [OrdersController],
  exports: [OrdersService],
})
export class OrdersModule {}
