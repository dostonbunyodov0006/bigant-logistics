import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  createUserSchema,
  roleSchema,
  updateUserSchema,
  userFilterSchema,
  type CreateUserInput,
  type Role,
  type UpdateUserInput,
  type UserFilterInput,
} from '@bigant/shared';
import { UsersService } from './users.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // A dispatcher sees the accounts and may switch one off; only an admin
  // creates, edits or removes one for good.
  @Roles('admin', 'manager')
  @Get()
  list(
    @Query(new ZodValidationPipe(userFilterSchema)) filters: UserFilterInput,
    @Query('role') role?: string,
  ) {
    const parsed = roleSchema.safeParse(role);
    return this.users.list(parsed.success ? (parsed.data as Role) : undefined, filters);
  }

  /** Declared before ':id' so the literal path is not read as a user id. */
  @Roles('admin', 'manager')
  @Get('page')
  listPage(
    @Query(new ZodValidationPipe(userFilterSchema)) filters: UserFilterInput,
    @Query('role') role?: string,
  ) {
    const parsed = roleSchema.safeParse(role);
    return this.users.listPage(parsed.success ? (parsed.data as Role) : undefined, filters);
  }

  @Roles('admin', 'manager')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.users.getPublicById(id);
  }

  @Roles('admin')
  @Post()
  create(
    @Body(new ZodValidationPipe(createUserSchema)) body: CreateUserInput,
    @CurrentUser('role') role: Role,
  ) {
    return this.users.create(body, role);
  }

  @Roles('admin', 'manager')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) body: UpdateUserInput,
    @CurrentUser('role') role: Role,
  ) {
    // A dispatcher may only flip the status; the rest of the record is the admin's.
    if (role !== 'admin' && Object.keys(body).some((k) => k !== 'status')) {
      throw new ForbiddenException('admins_only');
    }
    return this.users.update(id, body, role);
  }

  /** Switch the account off: it keeps its history and can be switched back on.
   *  Nothing deletes an account for good (owner, 29.10.2026). */
  @Roles('admin', 'manager')
  @Delete(':id')
  deactivate(@Param('id') id: string, @CurrentUser('role') role: Role) {
    return this.users.deactivate(id, role);
  }
}
