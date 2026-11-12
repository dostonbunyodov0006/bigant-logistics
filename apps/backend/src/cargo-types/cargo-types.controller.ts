import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  createCargoTypeSchema,
  updateCargoTypeSchema,
  type CreateCargoTypeInput,
  type UpdateCargoTypeInput,
} from '@bigant/shared';
import { CargoTypesService } from './cargo-types.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

@ApiTags('cargo-types')
@ApiBearerAuth()
@Controller('cargo-types')
export class CargoTypesController {
  constructor(private readonly cargoTypes: CargoTypesService) {}

  @Roles('admin', 'manager')
  @Get()
  list() {
    return this.cargoTypes.list();
  }

  @RequirePermission('manage_cargo_types')
  @Post()
  create(@Body(new ZodValidationPipe(createCargoTypeSchema)) body: CreateCargoTypeInput) {
    return this.cargoTypes.create(body);
  }

  @RequirePermission('manage_cargo_types')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCargoTypeSchema)) body: UpdateCargoTypeInput,
  ) {
    return this.cargoTypes.update(id, body);
  }

  @RequirePermission('manage_cargo_types')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.cargoTypes.remove(id);
  }
}
