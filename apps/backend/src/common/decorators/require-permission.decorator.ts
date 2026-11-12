import { SetMetadata } from '@nestjs/common';
import type { Feature } from '@bigant/shared';

export const PERMISSION_KEY = 'permission';

/** Restricts a route to roles that hold the given feature permission (§5 matrix). */
export const RequirePermission = (feature: Feature) => SetMetadata(PERMISSION_KEY, feature);
