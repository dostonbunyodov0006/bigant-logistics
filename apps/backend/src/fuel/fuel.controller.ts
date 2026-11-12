import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  confirmFuelLogSchema,
  correctFuelReadingSchema,
  createFuelLogSchema,
  createFuelStationSchema,
  fuelLogFilterSchema,
  fuelPeriodSchema,
  listFuelStationsQuerySchema,
  nearbyFuelStationsQuerySchema,
  payFuelDriverSchema,
  settleFuelLogSchema,
  updateFuelStationSchema,
  type ConfirmFuelLogInput,
  type CorrectFuelReadingInput,
  type CreateFuelLogInput,
  type CreateFuelStationInput,
  type FuelLogFilterInput,
  type FuelPeriodInput,
  type ListFuelStationsQuery,
  type NearbyFuelStationsQuery,
  type PayFuelDriverInput,
  type SettleFuelLogInput,
  type UpdateFuelStationInput,
} from '@bigant/shared';
import { FuelService } from './fuel.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { tashkentDayStartUtc } from '../common/tashkent-time';

@ApiTags('fuel')
@ApiBearerAuth()
@Controller('fuel')
export class FuelController {
  constructor(private readonly fuel: FuelService) {}

  // --- Stations, as the driver sees them ---

  /** Whether arrival at the station is checked, and how close counts. */
  @Roles('driver', 'admin', 'manager')
  @Get('config')
  config() {
    return this.fuel.config();
  }

  /** "Ro'yxat": live contracted stations, optionally only those selling this fuel. */
  @Roles('driver', 'admin', 'manager')
  @Get('stations')
  listStations(@Query(new ZodValidationPipe(listFuelStationsQuerySchema)) q: ListFuelStationsQuery) {
    return this.fuel.listStations(q.fuel_type);
  }

  /** "Yaqinimda": the nearest few within range, with distances. */
  @Roles('driver', 'admin', 'manager')
  @Get('stations/nearby')
  nearby(@Query(new ZodValidationPipe(nearbyFuelStationsQuerySchema)) q: NearbyFuelStationsQuery) {
    return this.fuel.nearbyStations({ lat: q.lat, lng: q.lng }, q.fuel_type);
  }

  // --- Stations, maintained by admin ---

  @RequirePermission('manage_fuel')
  @Get('stations/all')
  listAllStations() {
    return this.fuel.listAllStations();
  }

  @RequirePermission('manage_fuel')
  @Post('stations')
  createStation(@Body(new ZodValidationPipe(createFuelStationSchema)) body: CreateFuelStationInput) {
    return this.fuel.createStation(body);
  }

  @RequirePermission('manage_fuel')
  @Patch('stations/:id')
  updateStation(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateFuelStationSchema)) body: UpdateFuelStationInput,
  ) {
    return this.fuel.updateStation(id, body);
  }

  // --- Logs ---

  /** The photo and the phone's position. Opens a draft. */
  @Roles('driver')
  @Post('logs')
  createDraft(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(createFuelLogSchema)) body: CreateFuelLogInput,
  ) {
    return this.fuel.createDraft(body, actor);
  }

  /** The numbers, as the driver confirms them. */
  @Roles('driver')
  @Post('logs/:id/confirm')
  confirm(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(confirmFuelLogSchema)) body: ConfirmFuelLogInput,
  ) {
    return this.fuel.confirm(id, body, actor);
  }

  @Roles('driver')
  @Get('logs/mine')
  mine(@CurrentUser() actor: AuthenticatedUser) {
    return this.fuel.myLogs(actor);
  }

  // --- Admin: the ledger, the queue, the month-end ---

  @RequirePermission('manage_fuel')
  @Get('logs')
  list(@Query(new ZodValidationPipe(fuelLogFilterSchema)) f: FuelLogFilterInput) {
    return this.fuel.listLogs({
      driver_id: f.driver_id,
      station_id: f.station_id,
      fuel_type: f.fuel_type,
      outcome: f.outcome,
      edited: f.edited,
      settlement_state: f.settlement_state,
      ...period(f),
    });
  }

  @RequirePermission('manage_fuel')
  @Get('summary')
  summary(@Query(new ZodValidationPipe(fuelPeriodSchema)) q: FuelPeriodInput) {
    return this.fuel.summary(period(q));
  }

  /** Per station, to hold against the invoice it sends. */
  @RequirePermission('manage_fuel')
  @Get('settlement/stations')
  stationTotals(@Query(new ZodValidationPipe(fuelPeriodSchema)) q: FuelPeriodInput) {
    return this.fuel.stationTotals(period(q));
  }

  /** Per driver, what they are owed and have not been paid. */
  @RequirePermission('manage_fuel')
  @Get('settlement/drivers')
  driverDebts() {
    return this.fuel.driverDebts();
  }

  /** Cash handed over: closes every reimbursement due up to that day. */
  @RequirePermission('manage_fuel')
  @Post('settlement/drivers/:driverId/pay')
  payDriver(
    @Param('driverId') driverId: string,
    @Body(new ZodValidationPipe(payFuelDriverSchema)) body: PayFuelDriverInput,
  ) {
    return this.fuel.payDriver(driverId, body.to ? endOfDay(body.to) : new Date());
  }

  /** One fill's money handed back to the driver. */
  @RequirePermission('manage_fuel')
  @Post('logs/:id/pay')
  payLog(@Param('id') id: string) {
    return this.fuel.payLog(id);
  }

  @RequirePermission('manage_fuel')
  @Get('logs/:id')
  getLog(@Param('id') id: string) {
    return this.fuel.getLog(id);
  }

  /** An admin corrects the three numbers against the photo. */
  @RequirePermission('manage_fuel')
  @Patch('logs/:id/reading')
  correct(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(correctFuelReadingSchema)) body: CorrectFuelReadingInput,
  ) {
    return this.fuel.correctReading(id, body, actor);
  }

  /** A person's decision on who pays, or a correction of the fence's. */
  @RequirePermission('manage_fuel')
  @Patch('logs/:id/settlement')
  settle(@Param('id') id: string, @Body(new ZodValidationPipe(settleFuelLogSchema)) body: SettleFuelLogInput) {
    return this.fuel.settle(id, body);
  }
}

/** Calendar-day bounds, inclusive on both ends. */
const startOfDay = (d: string) => tashkentDayStartUtc(d);
const endOfDay = (d: string) => new Date(tashkentDayStartUtc(d).getTime() + 86_400_000 - 1);
const period = (q: { from?: string; to?: string }) => ({
  from: q.from ? startOfDay(q.from) : undefined,
  to: q.to ? endOfDay(q.to) : undefined,
});
