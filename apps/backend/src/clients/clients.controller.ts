import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  clientFilterSchema,
  createClientAddressSchema,
  createClientSchema,
  updateClientAddressSchema,
  updateClientSchema,
  type ClientFilterInput,
  type CreateClientAddressInput,
  type CreateClientInput,
  type UpdateClientAddressInput,
  type UpdateClientInput,
} from '@bigant/shared';
import { ClientsService } from './clients.service';
import { ClientAddressesService } from './client-addresses.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

@ApiTags('clients')
@ApiBearerAuth()
@Controller('clients')
export class ClientsController {
  constructor(
    private readonly clients: ClientsService,
    private readonly addresses: ClientAddressesService,
  ) {}

  // --- The client's places ------------------------------------------------
  // Declared before ':id' so "addresses" is not read as a client id.

  /** Every place this client takes deliveries at, the default first. */
  @Roles('admin', 'seller')
  @Get(':id/addresses')
  listAddresses(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.addresses.list(id, actor);
  }

  @RequirePermission('create_client')
  @Post(':id/addresses')
  addAddress(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(createClientAddressSchema)) body: CreateClientAddressInput,
  ) {
    return this.addresses.create(id, body, actor);
  }

  @Roles('admin', 'seller')
  @Patch('addresses/:addressId')
  updateAddress(
    @Param('addressId') addressId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateClientAddressSchema)) body: UpdateClientAddressInput,
  ) {
    return this.addresses.update(addressId, body, actor);
  }

  @RequirePermission('create_client')
  @Post()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(createClientSchema)) body: CreateClientInput,
  ) {
    return this.clients.create(body, actor);
  }

  /** A seller gets their own clients; staff get all, optionally one seller's. */
  @Roles('admin', 'seller')
  @Get()
  findAll(
    @CurrentUser() actor: AuthenticatedUser,
    @Query(new ZodValidationPipe(clientFilterSchema)) filters: ClientFilterInput,
  ) {
    return this.clients.findAll(filters, actor);
  }

  /** Declared before ':id' so the literal path is not read as a client id.
   *  Had no role guard at all — any signed-in account, drivers included, could
   *  page through every client. */
  @Roles('admin', 'seller')
  @Get('page')
  findPage(
    @CurrentUser() actor: AuthenticatedUser,
    @Query(new ZodValidationPipe(clientFilterSchema)) filters: ClientFilterInput,
  ) {
    return this.clients.findPage(filters, actor);
  }

  @Roles('admin', 'seller')
  @Get(':id')
  findOne(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.clients.findOne(id, actor);
  }

  @Roles('admin', 'seller')
  @Patch(':id')
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateClientSchema)) body: UpdateClientInput,
  ) {
    return this.clients.update(id, body, actor);
  }

  @Roles('admin')
  @Delete(':id')
  remove(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.clients.remove(id, actor);
  }
}
