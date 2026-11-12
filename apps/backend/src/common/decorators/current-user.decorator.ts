import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Role } from '@bigant/shared';

export interface AuthenticatedUser {
  userId: string;
  role: Role;
}

/** Injects the authenticated user (or one of its fields) into a handler. */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;
    return field && user ? user[field] : user;
  },
);
