import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  clockInSchema,
  clockOutSchema,
  extendShiftSchema,
  correctWorkLogSchema,
  monthFilterSchema,
  createDriverDocumentSchema,
  createDriverSchema,
  driverBreakSchema,
  driverBreakExtendSchema,
  type DriverBreakExtendInput,
  earningsFilterSchema,
  logKmSchema,
  reportIncidentSchema,
  timesheetFilterSchema,
  updateDriverDocumentSchema,
  updateDriverLocationSchema,
  driverLocationBatchSchema,
  type DriverLocationBatchInput,
  updateDriverSchema,
  type ClockInInput,
  type ClockOutInput,
  type ExtendShiftInput,
  type CorrectWorkLogInput,
  type MonthFilterInput,
  type DriverBreakInput,
  type CreateDriverDocumentInput,
  type CreateDriverInput,
  type EarningsFilterInput,
  type LogKmInput,
  type ReportIncidentInput,
  type TimesheetFilterInput,
  type UpdateDriverDocumentInput,
  type UpdateDriverInput,
  type UpdateDriverLocationInput,
} from '@bigant/shared';
import { DriversService, periodRange } from './drivers.service';
import { MorningStartService } from './morning-start.service';
import { IdleReportService } from './idle-report.service';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

@ApiTags('drivers')
@ApiBearerAuth()
@Controller('drivers')
export class DriversController {
  constructor(
    private readonly drivers: DriversService,
    private readonly mornings: MorningStartService,
    private readonly idle: IdleReportService,
  ) {}

  @RequirePermission('create_driver_account')
  @Post()
  create(@Body(new ZodValidationPipe(createDriverSchema)) body: CreateDriverInput) {
    return this.drivers.create(body);
  }

  @Roles('driver')
  @Get('me')
  findMe(@CurrentUser('userId') userId: string) {
    return this.drivers.findByUserId(userId);
  }

  @Roles('driver')
  @Get('me/earnings')
  myEarnings(
    @CurrentUser('userId') userId: string,
    @Query(new ZodValidationPipe(earningsFilterSchema)) query: EarningsFilterInput,
  ) {
    return this.drivers.getMyEarnings(userId, query.period);
  }

  @Roles('driver')
  @Get('me/morning-starts')
  myMorningStarts(
    @CurrentUser('userId') userId: string,
    @Query(new ZodValidationPipe(earningsFilterSchema)) query: EarningsFilterInput,
  ) {
    const { from, to } = periodRange(query.period);
    return this.mornings.listMine(userId, from, to);
  }

  @Roles('driver')
  @Post('me/location')
  @HttpCode(200)
  updateLocation(
    @CurrentUser('userId') userId: string,
    @Body(new ZodValidationPipe(updateDriverLocationSchema)) body: UpdateDriverLocationInput,
  ) {
    return this.drivers.updateLocation(userId, body);
  }

  /** A key for the phone's own location service (it runs outside the app's login). */
  @Roles('driver')
  @Post('me/location-key')
  @HttpCode(200)
  locationKey(@CurrentUser('userId') userId: string) {
    return this.drivers.issueLocationKey(userId);
  }

  /**
   * Positions from the phone's own location service, with the app closed and
   * the phone asleep (owner, 05.11.2026). No login: the key says whose phone.
   */
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('location/ingest')
  @HttpCode(200)
  ingestLocation(
    @Headers('x-location-key') key: string | undefined,
    @Body(new ZodValidationPipe(driverLocationBatchSchema)) body: DriverLocationBatchInput,
  ) {
    return this.drivers.ingestLocationByKey(key, body);
  }

  /** Fixes kept on the phone while it had no internet, with their own times. */
  @Roles('driver')
  @Post('me/location/batch')
  @HttpCode(200)
  updateLocationBatch(
    @CurrentUser('userId') userId: string,
    @Body(new ZodValidationPipe(driverLocationBatchSchema)) body: DriverLocationBatchInput,
  ) {
    return this.drivers.updateLocationBatch(userId, body);
  }

  @Roles('driver')
  @Post('me/km')
  logMyKm(
    @CurrentUser('userId') userId: string,
    @Body(new ZodValidationPipe(logKmSchema)) body: LogKmInput,
  ) {
    return this.drivers.logMyKm(userId, body.km, body.photo_url ?? null);
  }

  /** Whether this fill asks for the odometer (once a week). */
  @Roles('driver')
  @Get('me/km/due')
  myKmDue(@CurrentUser('userId') userId: string) {
    return this.drivers.myKmDue(userId);
  }

  @Roles('driver')
  @Post('me/incidents')
  reportIncident(
    @CurrentUser('userId') userId: string,
    @Body(new ZodValidationPipe(reportIncidentSchema)) body: ReportIncidentInput,
  ) {
    return this.drivers.reportIncident(userId, body);
  }

  @Roles('driver')
  @Post('me/shifts/clock-in')
  clockIn(
    @CurrentUser('userId') userId: string,
    @Body(new ZodValidationPipe(clockInSchema)) body: ClockInInput,
  ) {
    return this.drivers.clockIn(userId, body);
  }

  @Roles('driver')
  @Post('me/shifts/clock-out')
  clockOut(
    @CurrentUser('userId') userId: string,
    @Body(new ZodValidationPipe(clockOutSchema)) body: ClockOutInput,
  ) {
    return this.drivers.clockOut(userId, body);
  }

  /** "+30 min" on the end-of-day reminder — still working, ask again in 30. A note is required (owner, 07.11.2026). */
  @Roles('driver')
  @Post('me/shifts/end-check/extend')
  extendShift(
    @CurrentUser('userId') userId: string,
    @Body(new ZodValidationPipe(extendShiftSchema)) body: ExtendShiftInput,
  ) {
    return this.drivers.extendShift(userId, body);
  }

  /** "STOP" on the end-of-day reminder — end the shift now. */
  @Roles('driver')
  @Post('me/shifts/end-check/stop')
  stopShift(
    @CurrentUser('userId') userId: string,
    @Body(new ZodValidationPipe(clockOutSchema)) body: ClockOutInput,
  ) {
    return this.drivers.stopShift(userId, body);
  }

  @Roles('driver')
  @Get('me/shifts')
  myShifts(@CurrentUser('userId') userId: string) {
    return this.drivers.listMyWorkLogs(userId);
  }

  @Roles('driver')
  @Post('me/break')
  startBreak(
    @CurrentUser('userId') userId: string,
    @Body(new ZodValidationPipe(driverBreakSchema)) body: DriverBreakInput,
  ) {
    return this.drivers.startBreak(userId, body);
  }

  @Roles('driver')
  @Post('me/break/extend')
  extendBreak(
    @CurrentUser('userId') userId: string,
    @Body(new ZodValidationPipe(driverBreakExtendSchema)) body: DriverBreakExtendInput,
  ) {
    return this.drivers.extendBreak(userId, body);
  }

  @Roles('driver')
  @Delete('me/break')
  endBreak(@CurrentUser('userId') userId: string) {
    return this.drivers.endBreak(userId);
  }

  // Static routes registered before ':id' so they aren't captured as an id param.
  @Roles('admin', 'manager')
  @Get('timesheet')
  getTimesheet(
    @Query(new ZodValidationPipe(timesheetFilterSchema)) filters: TimesheetFilterInput,
  ) {
    return this.drivers.getTimesheet(filters);
  }

  @Roles('admin', 'manager')
  @Get('work-report')
  getWorkReport(
    @Query(new ZodValidationPipe(timesheetFilterSchema)) filters: TimesheetFilterInput,
  ) {
    return this.drivers.getWorkReport(filters);
  }

  /** Bo'sh vaqt: each lorry's and driver's idle hours a day (owner, 05.11.2026). */
  @Roles('admin', 'manager')
  @Get('idle-report')
  getIdleReport(@Query(new ZodValidationPipe(timesheetFilterSchema)) filters: TimesheetFilterInput) {
    return this.idle.report(filters);
  }

  @Roles('admin', 'manager')
  @Get('idle-report/export')
  exportIdleReport(@Query(new ZodValidationPipe(timesheetFilterSchema)) filters: TimesheetFilterInput) {
    return this.idle.exportXlsx(filters);
  }

  @Roles('admin', 'manager')
  @Get('shift-alerts')
  getShiftAlerts() {
    return this.drivers.getShiftAlerts();
  }

  @Roles('admin', 'seller')
  @Get()
  findAll(@Query('search') search?: string, @Query('status') status?: string) {
    return this.drivers.findAll(search, status === 'inactive' ? 'inactive' : 'active');
  }

  @Roles('admin', 'seller')
  @Get('locations')
  findAllLocations() {
    return this.drivers.findAllLocations();
  }

  @Roles('admin', 'seller')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.drivers.findOne(id);
  }

  @Roles('admin')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateDriverSchema)) body: UpdateDriverInput,
  ) {
    return this.drivers.updateProfile(id, body);
  }

  /** Ishdan bo'shatish: the account is switched off, the history stays. */
  @Roles('admin')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.drivers.remove(id);
  }

  /** Qayta ishga olish. */
  @Roles('admin')
  @Post(':id/rehire')
  rehire(@Param('id') id: string) {
    return this.drivers.rehire(id);
  }

  @Roles('admin', 'manager')
  @Get(':id/morning-starts')
  listMorningStarts(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(monthFilterSchema)) query: MonthFilterInput,
  ) {
    return this.mornings.listFor(id, query.month);
  }

  @Roles('admin')
  @Get(':id/work-logs')
  listWorkLogs(@Param('id') id: string) {
    return this.drivers.listWorkLogs(id);
  }

  @Roles('admin')
  @Patch(':id/work-logs/:logId')
  correctWorkLog(
    @Param('id') id: string,
    @Param('logId') logId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(correctWorkLogSchema)) body: CorrectWorkLogInput,
  ) {
    return this.drivers.correctWorkLog(id, logId, body, actor);
  }

  @Roles('admin')
  @Get(':id/documents')
  listDocuments(@Param('id') id: string) {
    return this.drivers.listDocuments(id);
  }

  @Roles('admin')
  @Post(':id/documents')
  addDocument(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createDriverDocumentSchema)) body: CreateDriverDocumentInput,
  ) {
    return this.drivers.addDocument(id, body);
  }

  @Roles('admin')
  @Patch(':id/documents/:docId')
  updateDocument(
    @Param('id') id: string,
    @Param('docId') docId: string,
    @Body(new ZodValidationPipe(updateDriverDocumentSchema)) body: UpdateDriverDocumentInput,
  ) {
    return this.drivers.updateDocument(id, docId, body);
  }

  @Roles('admin')
  @Delete(':id/documents/:docId')
  removeDocument(@Param('id') id: string, @Param('docId') docId: string) {
    return this.drivers.removeDocument(id, docId);
  }
}
