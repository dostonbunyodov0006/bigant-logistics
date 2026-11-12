import { Module } from '@nestjs/common';
import { DriverTripController, EtaController } from './eta.controller';
import { EtaService } from './eta.service';
import { OrdersModule } from '../orders/orders.module';
import { RoutingModule } from '../routing/routing.module';
import { GeoModule } from '../geo/geo.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PolniyReminderService } from './polniy-reminder.service';
import { PolniyReminderDispatcher } from './polniy-reminder.dispatcher';

@Module({
  imports: [OrdersModule, RoutingModule, GeoModule, NotificationsModule],
  controllers: [EtaController, DriverTripController],
  providers: [EtaService, PolniyReminderService, PolniyReminderDispatcher],
  exports: [EtaService],
})
export class EtaModule {}
