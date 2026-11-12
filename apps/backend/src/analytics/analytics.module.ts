import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { ReturnsReportService } from './returns-report.service';
import { DriverAnalyticsService } from './driver-analytics.service';
import { DriverTrackService } from './driver-track.service';

@Module({
  controllers: [AnalyticsController],
  providers: [ReturnsReportService, DriverAnalyticsService, DriverTrackService],
})
export class AnalyticsModule {}
