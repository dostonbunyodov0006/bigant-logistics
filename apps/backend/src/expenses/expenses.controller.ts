import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  createExpenseSchema,
  createExpenseTypeSchema,
  expenseFilterSchema,
  updateExpenseSchema,
  updateExpenseTypeSchema,
  type CreateExpenseInput,
  type CreateExpenseTypeInput,
  type ExpenseFilterInput,
  type UpdateExpenseInput,
  type UpdateExpenseTypeInput,
} from '@bigant/shared';
import { ExpensesService } from './expenses.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

@ApiTags('expenses')
@ApiBearerAuth()
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  // --- Types (declared before :id routes) ---

  @Roles('admin', 'manager')
  @Get('types')
  listTypes() {
    return this.expenses.listTypes();
  }

  @RequirePermission('manage_expenses')
  @Post('types')
  createType(@Body(new ZodValidationPipe(createExpenseTypeSchema)) body: CreateExpenseTypeInput) {
    return this.expenses.createType(body);
  }

  @RequirePermission('manage_expenses')
  @Patch('types/:id')
  updateType(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateExpenseTypeSchema)) body: UpdateExpenseTypeInput,
  ) {
    return this.expenses.updateType(id, body);
  }

  @RequirePermission('manage_expenses')
  @Delete('types/:id')
  removeType(@Param('id') id: string) {
    return this.expenses.removeType(id);
  }

  // --- Report ---

  @Roles('admin', 'manager')
  @Get('summary')
  summary(@Query(new ZodValidationPipe(expenseFilterSchema)) filters: ExpenseFilterInput) {
    return this.expenses.summary(filters);
  }

  // --- Expenses ---

  @Roles('admin', 'manager')
  @Get()
  list(@Query(new ZodValidationPipe(expenseFilterSchema)) filters: ExpenseFilterInput) {
    return this.expenses.list(filters);
  }

  /** Same filters, plus the total match count for server-side pagination. */
  @Roles('admin', 'manager')
  @Get('page')
  listPage(@Query(new ZodValidationPipe(expenseFilterSchema)) filters: ExpenseFilterInput) {
    return this.expenses.listPage(filters);
  }

  @RequirePermission('manage_expenses')
  @Post()
  create(
    @Body(new ZodValidationPipe(createExpenseSchema)) body: CreateExpenseInput,
    @CurrentUser('userId') userId: string,
  ) {
    return this.expenses.create(body, userId);
  }

  @RequirePermission('manage_expenses')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateExpenseSchema)) body: UpdateExpenseInput,
  ) {
    return this.expenses.update(id, body);
  }

  @RequirePermission('manage_expenses')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.expenses.remove(id);
  }
}
