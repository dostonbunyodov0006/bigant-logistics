import { Module } from '@nestjs/common';
import { DriversService } from './drivers.service';
import { DriversController } from './drivers.controller';
import { DriverStatusDispatcher } from './driver-status.dispatcher';
import { ShiftEndCheckService } from './shift-end-check.service';
import { ShiftEndCheckDispatcher } from './shift-end-check.dispatcher';
import { LocationSilenceService } from './location-silence.service';
import { MorningStartService } from './morning-start.service';
import { MorningStartDispatcher } from './morning-start.dispatcher';
import { EveningOvertimeService } from './evening-overtime.service';
import { EveningOvertimeDispatcher } from './evening-overtime.dispatcher';
import { BreakReminderService } from './break-reminder.service';
import { BreakReminderDispatcher } from './break-reminder.dispatcher';
import { GeoModule } from '../geo/geo.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { AttendanceModule } from '../attendance/attendance.module';

import { IdleReportService } from './idle-report.service';

@Module({
  imports: [VehiclesModule, AttendanceModule, GeoModule, NotificationsModule],
  providers: [
    DriversService,
    DriverStatusDispatcher,
    ShiftEndCheckService,
    ShiftEndCheckDispatcher,
    LocationSilenceService,
    MorningStartService,
    MorningStartDispatcher,
    EveningOvertimeService,
    EveningOvertimeDispatcher,
    BreakReminderService,
    BreakReminderDispatcher,
    IdleReportService,
  ],
  controllers: [DriversController],
  exports: [DriversService, ShiftEndCheckService],
})
export class DriversModule {}
