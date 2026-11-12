import { Module } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { VehicleTariffsService } from './vehicle-tariffs.service';
import { SettingsController } from './settings.controller';

@Module({
  providers: [SettingsService, VehicleTariffsService],
  controllers: [SettingsController],
  exports: [SettingsService, VehicleTariffsService],
})
export class SettingsModule {}
