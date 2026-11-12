import { Module } from '@nestjs/common';
import { CargoTypesService } from './cargo-types.service';
import { CargoTypesController } from './cargo-types.controller';

@Module({
  providers: [CargoTypesService],
  controllers: [CargoTypesController],
  exports: [CargoTypesService],
})
export class CargoTypesModule {}
