import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  grantLeaveSchema,
  leaveRequestFilterSchema,
  reviewLeaveRequestSchema,
  type GrantLeaveInput,
  type LeaveRequestFilterInput,
  type ReviewLeaveRequestInput,
} from '@bigant/shared';
import { LeaveService } from './leave.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

@ApiTags('leave')
@ApiBearerAuth()
@Controller('leave')
export class LeaveController {
  constructor(private readonly leave: LeaveService) {}

  /** The office enters a driver's leave; nothing is requested from the phone. */
  @RequirePermission('manage_leave')
  @Post()
  grant(
    @Body(new ZodValidationPipe(grantLeaveSchema)) body: GrantLeaveInput,
    @CurrentUser('userId') userId: string,
  ) {
    return this.leave.grant(body, userId);
  }

  @Roles('driver')
  @Get('me')
  listMine(@CurrentUser('userId') userId: string) {
    return this.leave.listMine(userId);
  }

  @RequirePermission('manage_leave')
  @Get()
  listAll(@Query(new ZodValidationPipe(leaveRequestFilterSchema)) filters: LeaveRequestFilterInput) {
    return this.leave.listAll(filters);
  }

  @RequirePermission('manage_leave')
  @Patch(':id/review')
  review(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reviewLeaveRequestSchema)) body: ReviewLeaveRequestInput,
    @CurrentUser('userId') userId: string,
  ) {
    return this.leave.review(id, body, userId);
  }
}
