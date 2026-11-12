import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  createPickupPlaceSchema,
  createSupplierSchema,
  updatePickupPlaceSchema,
  updateSupplierSchema,
  type CreatePickupPlaceInput,
  type CreateSupplierInput,
  type UpdatePickupPlaceInput,
  type UpdateSupplierInput,
  type Role,
} from '@bigant/shared';
import { PickupPlacesService } from './pickup-places.service';
import { SuppliersService } from './suppliers.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

@ApiTags('pickup-places')
@ApiBearerAuth()
@Controller('pickup-places')
export class PickupPlacesController {
  constructor(
    private readonly pickupPlaces: PickupPlacesService,
    private readonly suppliers: SuppliersService,
  ) {}

  // --- Suppliers ---------------------------------------------------------
  // One supplier, several yards. Declared before ':id' so "suppliers" is not
  // read as a place id.

  /** The suppliers a seller can pick from; inactive ones only for staff. */
  @Roles('admin', 'seller')
  @Get('suppliers')
  listSuppliers() {
    return this.suppliers.list();
  }

  @Roles('admin')
  @Get('suppliers/all')
  listAllSuppliers() {
    return this.suppliers.list(true);
  }

  @Roles('admin', 'seller')
  @Post('suppliers')
  createSupplier(
    @CurrentUser('userId') userId: string,
    @Body(new ZodValidationPipe(createSupplierSchema)) body: CreateSupplierInput,
  ) {
    return this.suppliers.create(body, userId);
  }

  @Roles('admin')
  @Patch('suppliers/:supplierId')
  updateSupplier(
    @Param('supplierId') supplierId: string,
    @Body(new ZodValidationPipe(updateSupplierSchema)) body: UpdateSupplierInput,
  ) {
    return this.suppliers.update(supplierId, body);
  }

  // Sellers may add a pickup place (e.g. a custom one during an order, §5/FR-004).
  @Roles('admin', 'seller')
  @Post()
  create(
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
    @Body(new ZodValidationPipe(createPickupPlaceSchema)) body: CreatePickupPlaceInput,
  ) {
    return this.pickupPlaces.create(body, userId, role);
  }

  @Roles('admin', 'seller')
  @Get()
  findAll() {
    return this.pickupPlaces.findAll();
  }

  @Roles('admin', 'seller')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.pickupPlaces.findOne(id);
  }

  // Managing (editing/removing) pickup places is admin-only (§5).
  @RequirePermission('manage_pickup_places')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePickupPlaceSchema)) body: UpdatePickupPlaceInput,
  ) {
    return this.pickupPlaces.update(id, body);
  }

  @RequirePermission('manage_pickup_places')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.pickupPlaces.remove(id);
  }
}
