import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  addServiceVisitItemSchema,
  type AddServiceVisitItemInput,
  assignServiceVisitSchema,
  completeServiceVisitSchema,
  correctServiceTotalSchema,
  createServiceCenterSchema,
  createServiceReasonSchema,
  createServiceVisitSchema,
  declineServiceVisitSchema,
  nearbyServiceCentersQuerySchema,
  payServiceDriverSchema,
  servicePeriodSchema,
  serviceItemPhotoSchema,
  serviceReceiptReadSchema,
  type ServiceReceiptReadInput,
  serviceVisitFilterSchema,
  setServiceBaselineSchema,
  settleServiceVisitSchema,
  startServiceVisitSchema,
  suggestServiceReasonSchema,
  updateServiceCenterSchema,
  updateServiceReasonSchema,
  type AssignServiceVisitInput,
  type CompleteServiceVisitInput,
  type CorrectServiceTotalInput,
  type CreateServiceCenterInput,
  type CreateServiceReasonInput,
  type CreateServiceVisitInput,
  type DeclineServiceVisitInput,
  type NearbyServiceCentersQuery,
  type PayServiceDriverInput,
  type ServiceItemPhotoInput,
  type ServicePeriodInput,
  type ServiceVisitFilterInput,
  type SetServiceBaselineInput,
  type SettleServiceVisitInput,
  type StartServiceVisitInput,
  type SuggestServiceReasonInput,
  type UpdateServiceCenterInput,
  type UpdateServiceReasonInput,
} from '@bigant/shared';
import { ServiceService } from './service.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { tashkentDayStartUtc } from '../common/tashkent-time';

@ApiTags('service')
@ApiBearerAuth()
@Controller('service')
export class ServiceController {
  constructor(private readonly service: ServiceService) {}

  // --- Reasons ---

  /** The driver's checklist: the catalogue plus their own additions. */
  @Roles('driver')
  @Get('reasons')
  reasonsForDriver(@CurrentUser() actor: AuthenticatedUser) {
    return this.service.reasonsForDriver(actor);
  }

  /** A work that is not on the list; pending until admin promotes it. */
  @Roles('driver')
  @Post('reasons/suggest')
  suggestReason(@CurrentUser() actor: AuthenticatedUser, @Body(new ZodValidationPipe(suggestServiceReasonSchema)) body: SuggestServiceReasonInput) {
    return this.service.suggestReason(body, actor);
  }

  @RequirePermission('manage_service')
  @Get('reasons/all')
  listReasons() {
    return this.service.listReasons();
  }

  @RequirePermission('manage_service')
  @Post('reasons')
  createReason(@Body(new ZodValidationPipe(createServiceReasonSchema)) body: CreateServiceReasonInput) {
    return this.service.createReason(body);
  }

  @RequirePermission('manage_service')
  @Patch('reasons/:id')
  updateReason(@Param('id') id: string, @Body(new ZodValidationPipe(updateServiceReasonSchema)) body: UpdateServiceReasonInput) {
    return this.service.updateReason(id, body);
  }

  // --- Centres ---

  @Roles('driver', 'admin', 'manager')
  @Get('centers')
  listCenters() {
    return this.service.listCenters(false);
  }

  @Roles('driver', 'admin', 'manager')
  @Get('centers/nearby')
  nearbyCenters(@Query(new ZodValidationPipe(nearbyServiceCentersQuerySchema)) q: NearbyServiceCentersQuery) {
    return this.service.nearbyCenters({ lat: q.lat, lng: q.lng });
  }

  @RequirePermission('manage_service')
  @Get('centers/all')
  listAllCenters() {
    return this.service.listCenters(true);
  }

  @RequirePermission('manage_service')
  @Post('centers')
  createCenter(@Body(new ZodValidationPipe(createServiceCenterSchema)) body: CreateServiceCenterInput) {
    return this.service.createCenter(body);
  }

  @RequirePermission('manage_service')
  @Patch('centers/:id')
  updateCenter(@Param('id') id: string, @Body(new ZodValidationPipe(updateServiceCenterSchema)) body: UpdateServiceCenterInput) {
    return this.service.updateCenter(id, body);
  }

  // --- What is due ---

  /** The driver's banner: works in range or overdue on their vehicle. */
  @Roles('driver')
  @Get('due/mine')
  myDue(@CurrentUser() actor: AuthenticatedUser) {
    return this.service.myDue(actor);
  }

  @RequirePermission('manage_service')
  @Get('due')
  due(@Query('vehicle_id') vehicleId?: string) {
    return this.service.due(vehicleId || undefined);
  }

  /** Where a vehicle's schedule starts for a work it was last done on before the app. */
  @RequirePermission('manage_service')
  @Put('vehicles/:vehicleId/baseline')
  setBaseline(@Param('vehicleId') vehicleId: string, @Body(new ZodValidationPipe(setServiceBaselineSchema)) body: SetServiceBaselineInput) {
    return this.service.setBaseline(vehicleId, body);
  }

  // --- Visits: the driver ---

  @Roles('driver')
  @Get('visits/mine')
  myVisits(@CurrentUser() actor: AuthenticatedUser) {
    return this.service.myVisits(actor);
  }

  /** Emergency (starts now) or request (waits for admin). */
  @Roles('driver')
  @Post('visits')
  createVisit(@CurrentUser() actor: AuthenticatedUser, @Body(new ZodValidationPipe(createServiceVisitSchema)) body: CreateServiceVisitInput) {
    return this.service.createVisit(body, actor);
  }

  /** "I have arrived": the centre and the phone's position. */
  @Roles('driver')
  @Post('visits/:id/start')
  start(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body(new ZodValidationPipe(startServiceVisitSchema)) body: StartServiceVisitInput) {
    return this.service.start(id, body, actor);
  }

  @Roles('driver')
  @Post('visits/:id/items')
  addItem(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body(new ZodValidationPipe(addServiceVisitItemSchema)) body: AddServiceVisitItemInput) {
    return this.service.addItem(id, body, actor);
  }

  @Roles('driver')
  @Delete('visits/:id/items/:itemId')
  removeItem(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Param('itemId') itemId: string) {
    return this.service.removeItem(id, itemId, actor);
  }

  @Roles('driver')
  @Post('visits/:id/items/:itemId/photo')
  itemPhoto(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(serviceItemPhotoSchema)) body: ServiceItemPhotoInput,
  ) {
    return this.service.itemPhoto(id, itemId, body.photo_base64, actor, body.slot);
  }

  @Roles('driver')
  @Post('visits/:id/receipt-read')
  readReceipt(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(serviceReceiptReadSchema)) body: ServiceReceiptReadInput,
  ) {
    return this.service.readReceipt(id, body.photo_base64, actor);
  }

  @Roles('driver')
  @Post('visits/:id/complete')
  complete(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body(new ZodValidationPipe(completeServiceVisitSchema)) body: CompleteServiceVisitInput) {
    return this.service.complete(id, body, actor);
  }

  /** A driver withdraws a request; admin cancels anything not completed. */
  @Roles('driver', 'admin', 'manager')
  @Delete('visits/:id')
  cancel(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.service.cancel(id, actor);
  }

  // --- Visits: admin ---

  @RequirePermission('manage_service')
  @Get('visits')
  listVisits(@Query(new ZodValidationPipe(serviceVisitFilterSchema)) f: ServiceVisitFilterInput) {
    return this.service.listVisits({ ...f, ...period(f) });
  }

  /** Staff read any visit; a driver reads their own — the photos and cost screens live off it. */
  @Roles('driver', 'admin', 'manager')
  @Get('visits/:id')
  getVisit(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.service.getVisit(id, actor);
  }

  /** Admin sends a truck to service. */
  @RequirePermission('manage_service')
  @Post('visits/assign')
  assign(@CurrentUser() actor: AuthenticatedUser, @Body(new ZodValidationPipe(assignServiceVisitSchema)) body: AssignServiceVisitInput) {
    return this.service.assignVisit(body, actor);
  }

  @RequirePermission('manage_service')
  @Post('visits/:id/approve')
  approve(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.service.approve(id, actor);
  }

  @RequirePermission('manage_service')
  @Post('visits/:id/decline')
  decline(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body(new ZodValidationPipe(declineServiceVisitSchema)) body: DeclineServiceVisitInput) {
    return this.service.decline(id, body, actor);
  }

  @RequirePermission('manage_service')
  @Patch('visits/:id/total')
  correctTotal(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body(new ZodValidationPipe(correctServiceTotalSchema)) body: CorrectServiceTotalInput) {
    return this.service.correctTotal(id, body, actor);
  }

  @RequirePermission('manage_service')
  @Patch('visits/:id/settlement')
  settle(@Param('id') id: string, @Body(new ZodValidationPipe(settleServiceVisitSchema)) body: SettleServiceVisitInput) {
    return this.service.settle(id, body);
  }

  // --- Month-end ---

  @RequirePermission('manage_service')
  @Get('summary')
  summary(@Query(new ZodValidationPipe(servicePeriodSchema)) q: ServicePeriodInput) {
    return this.service.summary(period(q));
  }

  @RequirePermission('manage_service')
  @Get('settlement/centers')
  centerTotals(@Query(new ZodValidationPipe(servicePeriodSchema)) q: ServicePeriodInput) {
    return this.service.centerTotals(period(q));
  }

  @RequirePermission('manage_service')
  @Get('settlement/drivers')
  driverDebts() {
    return this.service.driverDebts();
  }

  @RequirePermission('manage_service')
  @Post('settlement/drivers/:driverId/pay')
  payDriver(@Param('driverId') driverId: string, @Body(new ZodValidationPipe(payServiceDriverSchema)) body: PayServiceDriverInput) {
    return this.service.payDriver(driverId, body.to ? endOfDay(body.to) : new Date());
  }
}

const endOfDay = (d: string) => new Date(tashkentDayStartUtc(d).getTime() + 86_400_000 - 1);
const period = (q: { from?: string; to?: string }) => ({
  from: q.from ? tashkentDayStartUtc(q.from) : undefined,
  to: q.to ? endOfDay(q.to) : undefined,
});
