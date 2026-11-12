import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@bigant/shared';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';

/** Global guard: enforces @Roles(...). No-op when a route declares no roles. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) {
      return true;
    }
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const role = request.user?.role;
    if (!role) {
      return false;
    }
    if (roles.includes(role)) {
      return true;
    }
    // A Manager is a second admin: it satisfies any admin-gated route.
    return role === 'manager' && roles.includes('admin');
  }
}
