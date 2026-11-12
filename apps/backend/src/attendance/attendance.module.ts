import { Module } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { ScheduleService } from './schedule.service';
import { AttendanceController } from './attendance.controller';

@Module({
  providers: [AttendanceService, ScheduleService],
  controllers: [AttendanceController],
  // DriversService resolves the effective schedule when a driver clocks in/out.
  exports: [ScheduleService, AttendanceService],
})
export class AttendanceModule {}
