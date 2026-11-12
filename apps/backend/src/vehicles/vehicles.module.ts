import { Module } from '@nestjs/common';
import { VehiclesService } from './vehicles.service';
import { VehiclesController } from './vehicles.controller';
import { OdometerReaderService } from './odometer-reader.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  providers: [VehiclesService, OdometerReaderService],
  controllers: [VehiclesController],
  exports: [VehiclesService, OdometerReaderService],
})
export class VehiclesModule {}
