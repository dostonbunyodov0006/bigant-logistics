import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import {
  registerPushTokenSchema,
  type RegisterPushTokenInput,
} from '@bigant/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  listMine(@CurrentUser() actor: AuthenticatedUser) {
    return this.notifications.listMine(actor);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() actor: AuthenticatedUser) {
    return this.notifications.unreadCount(actor);
  }

  @Patch('read-all')
  markAllRead(@CurrentUser() actor: AuthenticatedUser) {
    return this.notifications.markAllRead(actor);
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.notifications.markRead(id, actor);
  }

  @Post('push-token')
  registerPushToken(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(registerPushTokenSchema)) body: RegisterPushTokenInput,
  ) {
    return this.notifications.registerPushToken(actor.userId, body);
  }

  @Delete('push-token/:token')
  removePushToken(@CurrentUser() actor: AuthenticatedUser, @Param('token') token: string) {
    return this.notifications.removePushToken(actor.userId, token);
  }
}
