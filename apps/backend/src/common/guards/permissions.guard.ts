import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { can, type Feature } from '@bigant/shared';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';

/** Global guard: enforces @RequirePermission(...) against the §5 matrix. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const feature = this.reflector.getAllAndOverride<Feature | undefined>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!feature) {
      return true;
    }
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    return !!request.user && can(request.user.role, feature);
  }
}
