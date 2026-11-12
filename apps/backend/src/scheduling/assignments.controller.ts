import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  conflictQuerySchema,
  createAssignmentSchema,
  type ConflictQueryInput,
  type CreateAssignmentInput,
} from '@bigant/shared';
import { SchedulingService } from './scheduling.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

@ApiTags('assignments')
@ApiBearerAuth()
@Controller('assignments')
export class AssignmentsController {
  constructor(private readonly scheduling: SchedulingService) {}

  @Roles('admin', 'seller')
  @Post()
  assign(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(createAssignmentSchema)) body: CreateAssignmentInput,
  ) {
    return this.scheduling.assign(body.order_id, body.driver_id, actor, { binding: body.binding });
  }

  @Roles('admin', 'seller')
  @Get('conflicts')
  conflicts(@Query(new ZodValidationPipe(conflictQuerySchema)) query: ConflictQueryInput) {
    return this.scheduling.previewConflicts(query.driver_id, query.delivery_datetime);
  }

  @Roles('driver')
  @Get('mine')
  mine(@CurrentUser() actor: AuthenticatedUser) {
    return this.scheduling.listMine(actor);
  }

  @Roles('driver')
  @Post(':id/accept')
  accept(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.scheduling.accept(id, actor);
  }

  @Roles('driver')
  @Post(':id/reject')
  reject(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.scheduling.reject(id, actor);
  }
}
