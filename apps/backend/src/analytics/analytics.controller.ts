import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  driverAnalyticsFilterSchema,
  driverTrackFilterSchema,
  vozvratListFilterSchema,
  type DriverAnalytics,
  type DriverAnalyticsFilterInput,
  type DriverTrack,
  type DriverTrackFilterInput,
  type VozvratListFilterInput,
  type VozvratListPage,
} from '@bigant/shared';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ReturnsReportService } from './returns-report.service';
import { DriverAnalyticsService } from './driver-analytics.service';
import { DriverTrackService } from './driver-track.service';

/** The office's view of the drivers' work. Staff only. */
@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly returns: ReturnsReportService,
    private readonly drivers: DriverAnalyticsService,
    private readonly tracks: DriverTrackService,
  ) {}

  @Roles('admin', 'manager')
  @Get('vozvrat')
  vozvrat(
    @Query(new ZodValidationPipe(vozvratListFilterSchema)) filters: VozvratListFilterInput,
  ): Promise<VozvratListPage> {
    return this.returns.list(filters);
  }

  @Roles('admin', 'manager')
  @Get('drivers')
  driverMonth(
    @Query(new ZodValidationPipe(driverAnalyticsFilterSchema)) filters: DriverAnalyticsFilterInput,
  ): Promise<DriverAnalytics> {
    return this.drivers.month(filters.month);
  }

  @Roles('admin', 'manager')
  @Get('drivers/:id/track')
  driverTrack(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(driverTrackFilterSchema)) filters: DriverTrackFilterInput,
  ): Promise<DriverTrack> {
    return this.tracks.track(id, filters.date);
  }
}
