import { SetMetadata } from '@nestjs/common';
import type { Role } from '@bigant/shared';

export const ROLES_KEY = 'roles';

/** Restricts a route to the given role(s). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
