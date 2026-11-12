import { Module } from '@nestjs/common';
import { VozvratController } from './vozvrat.controller';
import { VozvratReportService } from './vozvrat-report.service';
import { VozvratReportDispatcher } from './vozvrat-report.dispatcher';
import { VozvratProductsService } from './vozvrat-products.service';
import { OmborModule } from '../ombor/ombor.module';

@Module({
  imports: [OmborModule],
  controllers: [VozvratController],
  providers: [VozvratReportService, VozvratReportDispatcher, VozvratProductsService],
  exports: [VozvratReportService],
})
export class VozvratModule {}
