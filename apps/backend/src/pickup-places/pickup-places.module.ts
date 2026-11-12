import { Module } from '@nestjs/common';
import { PickupPlacesService } from './pickup-places.service';
import { SuppliersService } from './suppliers.service';
import { PickupPlacesController } from './pickup-places.controller';

@Module({
  providers: [PickupPlacesService, SuppliersService],
  controllers: [PickupPlacesController],
  exports: [PickupPlacesService, SuppliersService],
})
export class PickupPlacesModule {}
