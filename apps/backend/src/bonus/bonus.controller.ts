import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  bonusLogFilterSchema,
  createBonusRuleSchema,
  updateBonusRuleSchema,
  type BonusLogFilterInput,
  type CreateBonusRuleInput,
  type UpdateBonusRuleInput,
} from '@bigant/shared';
import { BonusService } from './bonus.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

@ApiTags('bonus')
@ApiBearerAuth()
@Controller('bonus')
export class BonusController {
  constructor(private readonly bonus: BonusService) {}

  @Roles('admin', 'manager')
  @Get('rules')
  listRules() {
    return this.bonus.listRules();
  }

  @RequirePermission('manage_bonus_rules')
  @Post('rules')
  createRule(@Body(new ZodValidationPipe(createBonusRuleSchema)) body: CreateBonusRuleInput) {
    return this.bonus.createRule(body);
  }

  @RequirePermission('manage_bonus_rules')
  @Patch('rules/:id')
  updateRule(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateBonusRuleSchema)) body: UpdateBonusRuleInput,
  ) {
    return this.bonus.updateRule(id, body);
  }

  @RequirePermission('manage_bonus_rules')
  @Delete('rules/:id')
  removeRule(@Param('id') id: string) {
    return this.bonus.removeRule(id);
  }

  @Roles('admin', 'manager')
  @Get('logs')
  listLogs(@Query(new ZodValidationPipe(bonusLogFilterSchema)) filters: BonusLogFilterInput) {
    return this.bonus.listLogs(filters);
  }
}
