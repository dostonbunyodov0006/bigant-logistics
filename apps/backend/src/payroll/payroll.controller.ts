import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { payrollFilterSchema, type PayrollFilterInput } from '@bigant/shared';
import { PayrollService } from './payroll.service';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  /** Ish haqi: every driver with his three bonuses for the period. */
  @Roles('admin', 'manager')
  @Get('drivers')
  drivers(@Query(new ZodValidationPipe(payrollFilterSchema)) filters: PayrollFilterInput) {
    return this.payroll.listDrivers(filters);
  }

  /** The bonus workbook (Ишбай, Юк олиш, Юк топшириш, Ходимлар Жами, Жами сумма). */
  @Roles('admin', 'manager')
  @Get('export')
  export(@Query(new ZodValidationPipe(payrollFilterSchema)) filters: PayrollFilterInput) {
    return this.payroll.exportXlsx(filters);
  }

  /** One driver's own workbook: Ишбай, Юк олиш, Юк топшириш. */
  @Roles('admin', 'manager')
  @Get('drivers/:id/export')
  exportDriver(@Param('id') id: string, @Query(new ZodValidationPipe(payrollFilterSchema)) filters: PayrollFilterInput) {
    return this.payroll.exportXlsx(filters, id);
  }

  /** One driver's bonuses, one row each. */
  @Roles('admin', 'manager')
  @Get('drivers/:id')
  driver(@Param('id') id: string, @Query(new ZodValidationPipe(payrollFilterSchema)) filters: PayrollFilterInput) {
    return this.payroll.driverDetail(id, filters);
  }
}
