import { Module } from '@nestjs/common';
import { FleetDocsModule } from '../fleet-docs/fleet-docs.module';
import { SellerBoardService } from './seller-board.service';
import { SellerBoardController } from './seller-board.controller';
import { ReservationExpiryDispatcher } from './reservation-expiry.dispatcher';
import { PoputiModule } from '../poputi/poputi.module';
import { ClientsModule } from '../clients/clients.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PoputiModule, ClientsModule, FleetDocsModule, NotificationsModule],
  providers: [SellerBoardService, ReservationExpiryDispatcher],
  controllers: [SellerBoardController],
  exports: [SellerBoardService],
})
export class SellerBoardModule {}
