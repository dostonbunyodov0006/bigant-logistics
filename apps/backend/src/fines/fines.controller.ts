import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  createFineSchema,
  fineFilterSchema,
  updateFineSchema,
  type CreateFineInput,
  type FineFilterInput,
  type UpdateFineInput,
} from '@bigant/shared';
import { FinesService } from './fines.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

@ApiTags('fines')
@ApiBearerAuth()
@Controller('fines')
export class FinesController {
  constructor(private readonly fines: FinesService) {}

  @Roles('admin', 'manager')
  @Get()
  list(@Query(new ZodValidationPipe(fineFilterSchema)) filters: FineFilterInput) {
    return this.fines.list(filters);
  }

  /** Same filters, plus the total match count for server-side pagination. */
  @Roles('admin', 'manager')
  @Get('page')
  listPage(@Query(new ZodValidationPipe(fineFilterSchema)) filters: FineFilterInput) {
    return this.fines.listPage(filters);
  }

  @RequirePermission('manage_fines')
  @Post()
  create(
    @Body(new ZodValidationPipe(createFineSchema)) body: CreateFineInput,
    @CurrentUser('userId') userId: string,
  ) {
    return this.fines.create(body, userId);
  }

  @RequirePermission('manage_fines')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateFineSchema)) body: UpdateFineInput,
  ) {
    return this.fines.update(id, body);
  }

  @RequirePermission('manage_fines')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.fines.remove(id);
  }
}
