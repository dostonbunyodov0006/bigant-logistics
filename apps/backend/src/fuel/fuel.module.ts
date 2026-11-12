import { Module } from '@nestjs/common';
import { UploadModule } from '../upload/upload.module';
import { TelegramModule } from '../telegram/telegram.module';
import { FuelController } from './fuel.controller';
import { FuelService } from './fuel.service';
import { FuelReaderService } from './fuel-reader.service';

@Module({
  imports: [UploadModule, TelegramModule],
  controllers: [FuelController],
  providers: [FuelService, FuelReaderService],
  exports: [FuelService],
})
export class FuelModule {}
