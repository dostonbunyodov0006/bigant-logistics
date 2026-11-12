import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  cancelOrderSchema,
  createOrderSchema,
  createVozvratOrderSchema,
  deliverOrderSchema,
  orderExceptionSchema,
  orderFilterSchema,
  orderReturnSchema,
  orderReturnCompleteSchema,
  returnItemsRejectSchema,
  returnItemsConfirmSchema,
  type ReturnItemsConfirmInput,
  pickupLoadedSchema,
  type CancelOrderInput,
  type CreateOrderInput,
  type CreateVozvratOrderInput,
  type DeliverOrderInput,
  type OrderExceptionInput,
  type OrderFilterInput,
  type OrderReturnInput,
  type OrderReturnCompleteInput,
  type ReturnItemsRejectInput,
  type PickupLoadedInput,
} from '@bigant/shared';
import { OrdersService } from './orders.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @RequirePermission('create_order')
  @Post()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(createOrderSchema)) body: CreateOrderInput,
  ) {
    return this.orders.create(body, actor);
  }

  /** A vozvrat order: fetch returned goods back from a client (see createVozvratOrder). */
  @RequirePermission('create_order')
  @Post('vozvrat')
  createVozvrat(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(createVozvratOrderSchema)) body: CreateVozvratOrderInput,
  ) {
    return this.orders.createVozvratOrder(body, actor);
  }

  @Roles('admin', 'seller', 'driver')
  @Get()
  findAll(
    @CurrentUser() actor: AuthenticatedUser,
    @Query(new ZodValidationPipe(orderFilterSchema)) filters: OrderFilterInput,
  ) {
    return this.orders.findAllForActor(actor, filters);
  }

  @Roles('admin', 'seller', 'driver')
  @Get('stats')
  stats(
    @CurrentUser() actor: AuthenticatedUser,
    @Query(new ZodValidationPipe(orderFilterSchema)) filters: OrderFilterInput,
  ) {
    return this.orders.statsForActor(actor, filters);
  }

  // Server-side paginated list ({ items, total }). Static route before ':id'.
  @Roles('admin', 'seller', 'driver')
  @Get('page')
  findPage(
    @CurrentUser() actor: AuthenticatedUser,
    @Query(new ZodValidationPipe(orderFilterSchema)) filters: OrderFilterInput,
  ) {
    return this.orders.findPageForActor(actor, filters);
  }

  @Roles('admin', 'seller', 'driver')
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.orders.findOneForActor(id, actor);
  }

  @Roles('admin', 'seller')
  @Patch(':id/cancel')
  cancel(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(cancelOrderSchema)) body: CancelOrderInput,
  ) {
    return this.orders.cancel(id, body.reason, actor);
  }

  // --- Place-based journey (Option A): Heading to / Arrived at each pickup, then the customer. ---

  @Roles('driver')
  @Patch(':id/pickups/:pickupId/depart')
  departToPickup(
    @Param('id') id: string,
    @Param('pickupId') pickupId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.orders.departToPickup(id, pickupId, actor);
  }

  @Roles('driver')
  @Patch(':id/pickups/:pickupId/arrive')
  arriveAtPickup(
    @Param('id') id: string,
    @Param('pickupId') pickupId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(pickupLoadedSchema)) body: PickupLoadedInput,
  ) {
    return this.orders.arriveAtPickup(id, pickupId, actor, body.photo_url, body.comment ?? null);
  }

  @Roles('driver')
  @Patch(':id/depart-to-customer')
  departToCustomer(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.orders.departToCustomer(id, actor);
  }

  @Roles('driver')
  @Patch(':id/arrive-at-customer')
  arriveAtCustomer(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.orders.arriveAtCustomer(id, actor);
  }

  @Roles('driver')
  @Patch(':id/deliver')
  deliver(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(deliverOrderSchema)) body: DeliverOrderInput,
  ) {
    return this.orders.completeDelivery(id, actor, body.photo_url, body.comment ?? null);
  }

  // --- Delivery outcomes at the customer: Istisno (exception) / Vozrat (return) ---

  @Roles('driver')
  @Patch(':id/exception')
  reportException(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(orderExceptionSchema)) body: OrderExceptionInput,
  ) {
    return this.orders.reportException(id, body, actor);
  }

  @Roles('driver')
  @Patch(':id/return')
  startReturn(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(orderReturnSchema)) body: OrderReturnInput,
  ) {
    return this.orders.startReturn(id, body, actor);
  }

  /** What the driver wrote up, for whoever is about to confirm it. */
  @Roles('admin', 'seller', 'driver')
  @Get(':id/return/items')
  returnItems(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.orders.returnItemsFor(id, actor);
  }

  // The seller checks what the driver wrote up. The office may answer for him
  // — a driver standing at a warehouse cannot wait for a seller's phone.
  @Roles('admin', 'seller')
  @Patch(':id/return/items/confirm')
  confirmReturnItems(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(returnItemsConfirmSchema)) body: ReturnItemsConfirmInput,
  ) {
    return this.orders.confirmReturnItems(id, actor, body);
  }

  @Roles('admin', 'seller')
  @Patch(':id/return/items/reject')
  rejectReturnItems(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(returnItemsRejectSchema)) body: ReturnItemsRejectInput,
  ) {
    return this.orders.rejectReturnItems(id, body.reason, actor);
  }

  /** Ojidaniya: set the return aside and do the next order first. */
  @Roles('driver')
  @Patch(':id/return/defer')
  deferReturn(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.orders.deferReturn(id, actor);
  }

  @Roles('driver')
  @Patch(':id/return/pickups/:pickupId/depart')
  departReturn(
    @Param('id') id: string,
    @Param('pickupId') pickupId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.orders.departReturn(id, pickupId, actor);
  }

  @Roles('driver')
  @Patch(':id/return/pickups/:pickupId/arrive')
  arriveReturn(
    @Param('id') id: string,
    @Param('pickupId') pickupId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.orders.arriveReturn(id, pickupId, actor);
  }

  @Roles('driver')
  @Patch(':id/return/pickups/:pickupId/complete')
  completeReturn(
    @Param('id') id: string,
    @Param('pickupId') pickupId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(orderReturnCompleteSchema)) body: OrderReturnCompleteInput,
  ) {
    return this.orders.completeReturn(id, pickupId, actor, body.photo_url, body.comment ?? null);
  }
}
