import { Module } from '@nestjs/common';
import { FleetDocsController } from './fleet-docs.controller';
import { FleetDocsService } from './fleet-docs.service';
import { UploadModule } from '../upload/upload.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [UploadModule, TelegramModule],
  controllers: [FleetDocsController],
  providers: [FleetDocsService],
  exports: [FleetDocsService],
})
export class FleetDocsModule {}
