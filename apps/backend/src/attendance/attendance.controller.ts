import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  attendanceFilterSchema,
  updateWorkScheduleSchema,
  type AttendanceFilterInput,
  type UpdateWorkScheduleInput,
} from '@bigant/shared';
import { AttendanceService } from './attendance.service';
import { ScheduleService } from './schedule.service';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

@ApiTags('attendance')
@ApiBearerAuth()
@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly schedule: ScheduleService,
  ) {}

  /** Davomat: who came, who was late, who never showed up. */
  @Roles('admin', 'manager')
  @Get()
  report(@Query(new ZodValidationPipe(attendanceFilterSchema)) filters: AttendanceFilterInput) {
    return this.attendance.report(filters);
  }

  // --- Schedules ---

  // Drivers may read the org schedule to see their expected hours.
  @Roles('admin', 'manager', 'driver')
  @Get('schedule')
  getOrgSchedule() {
    return this.schedule.get(null);
  }

  @Roles('admin')
  @Put('schedule')
  putOrgSchedule(
    @Body(new ZodValidationPipe(updateWorkScheduleSchema)) body: UpdateWorkScheduleInput,
  ) {
    return this.schedule.replace(null, body);
  }

  @Roles('admin', 'manager')
  @Get('schedule/:driverId')
  getDriverSchedule(@Param('driverId') driverId: string) {
    return this.schedule.get(driverId);
  }

  /** Send an empty `days` array to clear the override and re-inherit the org schedule. */
  @Roles('admin')
  @Put('schedule/:driverId')
  putDriverSchedule(
    @Param('driverId') driverId: string,
    @Body(new ZodValidationPipe(updateWorkScheduleSchema)) body: UpdateWorkScheduleInput,
  ) {
    return this.schedule.replace(driverId, body);
  }
}
