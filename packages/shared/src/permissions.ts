import type { Role } from './enums';

/**
 * Feature-level permissions derived from §5 of the Technical Requirements.
 *
 * Nuanced cells ("Optional", "Limited", "Can add during order") are encoded
 * conservatively here and refined with contextual checks in the relevant
 * domain modules during Phase 1. Decision #1: only Admin creates Seller accounts.
 */
export const FEATURES = [
  'create_client',
  'create_seller_account',
  'create_driver_account',
  'create_order',
  'assign_driver',
  'view_all_orders',
  'view_own_created_orders',
  'view_assigned_orders',
  'accept_reject_order',
  'mark_product_collected',
  'change_delivery_status',
  'manage_pickup_places',
  'manage_bonus_rules',
  'manage_fines',
  'manage_leave',
  'manage_expenses',
  'manage_cargo_types',
  'send_report_to_telegram',
  'manage_fuel',
  'manage_service',
] as const;
export type Feature = (typeof FEATURES)[number];

const ADMIN: Feature[] = [
  'create_client',
  'create_seller_account',
  'create_driver_account',
  'create_order',
  'assign_driver',
  'view_all_orders',
  'view_own_created_orders',
  'change_delivery_status',
  'manage_pickup_places',
  'manage_bonus_rules',
  'manage_fines',
  'manage_leave',
  'manage_expenses',
  'manage_cargo_types',
  'send_report_to_telegram',
  'manage_fuel',
  'manage_service',
];

const SELLER: Feature[] = [
  'create_client',
  'create_order',
  'assign_driver',
  'view_own_created_orders',
  // 'view_all_orders' is "Optional" in §5 — off by default.
  // 'manage_pickup_places' is limited to "add during order" — handled contextually.
];

const DRIVER: Feature[] = [
  'view_assigned_orders',
  'accept_reject_order',
  'mark_product_collected',
  'change_delivery_status',
  'send_report_to_telegram',
];

// A Manager is a second admin: same capabilities (decision — admin stays super-admin).
const MANAGER: Feature[] = [...ADMIN];

export const PERMISSION_MATRIX: Record<Role, ReadonlySet<Feature>> = {
  admin: new Set(ADMIN),
  manager: new Set(MANAGER),
  seller: new Set(SELLER),
  driver: new Set(DRIVER),
};

/** Returns true if the given role is allowed to use the given feature. */
export function can(role: Role, feature: Feature): boolean {
  return PERMISSION_MATRIX[role]?.has(feature) ?? false;
}
