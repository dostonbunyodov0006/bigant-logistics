import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  createIncidentSchema,
  createVehicleDocumentSchema,
  createVehicleSchema,
  vehicleFilterSchema,
  logKmSchema,
  updateVehicleDocumentSchema,
  updateVehicleSchema,
  type CreateIncidentInput,
  type CreateVehicleDocumentInput,
  type CreateVehicleInput,
  type LogKmInput,
  type UpdateVehicleDocumentInput,
  type UpdateVehicleInput,
  type VehicleFilterInput,
} from '@bigant/shared';
import { VehiclesService } from './vehicles.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

// Fleet management is admin-only (managers inherit admin routes via RolesGuard).
@ApiTags('vehicles')
@ApiBearerAuth()
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Roles('admin')
  @Get()
  findAll(@Query(new ZodValidationPipe(vehicleFilterSchema)) filters: VehicleFilterInput) {
    return this.vehicles.findAll(filters);
  }

  /** Declared before ':id' so the literal path is not read as a vehicle id. */
  @Roles('admin')
  @Get('page')
  findPage(@Query(new ZodValidationPipe(vehicleFilterSchema)) filters: VehicleFilterInput) {
    return this.vehicles.findPage(filters);
  }

  /** Drivers a power of attorney in force names for this lorry. */
  @Roles('admin')
  @Get(':id/authorized-drivers')
  authorizedDrivers(@Param('id') id: string) {
    return this.vehicles.authorizedDrivers(id);
  }

  @Roles('admin')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.vehicles.findOne(id);
  }

  @Roles('admin')
  @Get(':id/km')
  listKm(@Param('id') id: string) {
    return this.vehicles.listKm(id);
  }

  @Roles('admin')
  @Post(':id/km')
  logKm(
    @Param('id') id: string,
    @CurrentUser('userId') userId: string,
    @Body(new ZodValidationPipe(logKmSchema)) body: LogKmInput,
  ) {
    // Admin/manager only: past the 10 000 km jump check (owner, 07.11.2026).
    return this.vehicles.logKm(id, body.km, userId, null, null, { office: true });
  }

  @Roles('admin')
  @Get(':id/documents')
  listDocuments(@Param('id') id: string) {
    return this.vehicles.listDocuments(id);
  }

  @Roles('admin')
  @Post(':id/documents')
  addDocument(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createVehicleDocumentSchema)) body: CreateVehicleDocumentInput,
  ) {
    return this.vehicles.addDocument(id, body);
  }

  @Roles('admin')
  @Patch(':id/documents/:docId')
  updateDocument(
    @Param('id') id: string,
    @Param('docId') docId: string,
    @Body(new ZodValidationPipe(updateVehicleDocumentSchema)) body: UpdateVehicleDocumentInput,
  ) {
    return this.vehicles.updateDocument(id, docId, body);
  }

  @Roles('admin')
  @Delete(':id/documents/:docId')
  removeDocument(@Param('id') id: string, @Param('docId') docId: string) {
    return this.vehicles.removeDocument(id, docId);
  }

  @Roles('admin')
  @Get(':id/incidents')
  listIncidents(@Param('id') id: string) {
    return this.vehicles.listIncidents(id);
  }

  @Roles('admin')
  @Post(':id/incidents')
  addIncident(
    @Param('id') id: string,
    @CurrentUser('userId') userId: string,
    @Body(new ZodValidationPipe(createIncidentSchema)) body: CreateIncidentInput,
  ) {
    return this.vehicles.addIncident(id, body, userId);
  }

  @Roles('admin')
  @Delete(':id/incidents/:incidentId')
  removeIncident(@Param('id') id: string, @Param('incidentId') incidentId: string) {
    return this.vehicles.removeIncident(id, incidentId);
  }

  @Roles('admin')
  @Post()
  create(@Body(new ZodValidationPipe(createVehicleSchema)) body: CreateVehicleInput) {
    return this.vehicles.create(body);
  }

  @Roles('admin')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateVehicleSchema)) body: UpdateVehicleInput,
  ) {
    return this.vehicles.update(id, body);
  }

  @Roles('admin')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.vehicles.remove(id);
  }
}
