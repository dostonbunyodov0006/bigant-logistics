/**
 * Canonical enums for the Logistics domain.
 * These are the single source of truth shared by backend, web, and mobile.
 * Mirror the Prisma schema exactly.
 */

export const ROLES = ['admin', 'manager', 'seller', 'driver'] as const;
export type Role = (typeof ROLES)[number];

/** Roles an admin/manager can create & manage via the user-management endpoints. */
export const MANAGEABLE_ROLES = ['seller', 'manager', 'admin'] as const satisfies readonly Role[];
export type ManageableRole = (typeof MANAGEABLE_ROLES)[number];

export const USER_STATUSES = ['active', 'inactive'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const DRIVER_STATUSES = ['available', 'busy', 'offline', 'on_delivery'] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

/** Order lifecycle. See PROJECT_PLAN.md §3 for the state machine.
 *  `arrived_at_customer` sits between `on_the_way` and `delivered` — the driver
 *  has reached the client and is choosing an outcome (deliver / exception / return). */
export const ORDER_STATUSES = [
  'created',
  'awaiting_details',
  'assigned_to_driver',
  'driver_accepted',
  'collecting_items',
  'items_collected',
  'on_the_way',
  'arrived_at_customer',
  'delivered',
  // Vozrat (return): the customer refused some/all goods; the driver is taking
  // them back (returning), then confirms drop-off (returned, terminal).
  'returning',
  'returned',
  'cancelled',
  'problem',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Driver-selected reasons for a non-terminal Istisno report. */
export const ORDER_EXCEPTION_REASONS = [
  'client_absent',
  'client_unreachable',
  'wrong_address',
  'client_refused',
  'payment_problem',
  'cargo_problem',
  'other',
] as const;
export type OrderExceptionReason = (typeof ORDER_EXCEPTION_REASONS)[number];

/** Where returned goods go back to (Vozrat destination). */
export const RETURN_DESTINATIONS = ['warehouse', 'store', 'supplier'] as const;
export type ReturnDestination = (typeof RETURN_DESTINATIONS)[number];

/** Stage of the Vozrat return trip. null = carrying (not started); then the
 *  driver heads to the place → arrives → hands back (→ returned). */
export const RETURN_STAGES = ['heading', 'arrived'] as const;
export type ReturnStage = (typeof RETURN_STAGES)[number];

/** Per-stop leg status on the driver's journey (each pickup place, then the client).
 *  pending → en_route (Heading to…) → arrived (Arrived at…). */
export const LEG_STATUSES = ['pending', 'en_route', 'arrived'] as const;
export type LegStatus = (typeof LEG_STATUSES)[number];

/** The single action a driver can take next on an active order — computed
 *  server-side from the order status + per-pickup leg statuses, so the mobile
 *  app just renders one button. See `driverNextActionSchema`. */
/** What an order is for: bringing goods to a client, or fetching returned goods
 *  back from one days after a delivery (a vozvrat order: client → warehouse). */
export const ORDER_KINDS = ['delivery', 'vozvrat'] as const;
export type OrderKind = (typeof ORDER_KINDS)[number];

export const DRIVER_NEXT_ACTIONS = [
  'depart_pickup', // Heading to pickup N
  'arrive_pickup', // Arrived at pickup N
  'depart_customer', // Heading to the customer
  'arrive_customer', // Arrived at the customer
  'deliver', // At the customer: deliver / exception (Istisno) / return (Vozrat)
  'collect_return', // Vozvrat order, at the customer: write up what comes back
  'waiting_for_trip_stop', // Co-load: another order's stop comes first on this trip
  'return_confirm_wait', // Written up, waiting for the seller to check it
  'return_rewrite', // The seller sent it back: write the goods up again
  'return_configure', // Returning: choose a destination for every collected pickup
  'return_depart', // Returning: head to the return place ({joy}ga yo'l oldim)
  'return_arrive', // Returning: arrived at the return place ({joy}ga yetib keldim)
  'return_wait_warehouse', // At the warehouse: the storekeeper has not taken the goods in yet
  'return_complete', // Returning: hand the goods back (Vozratni topshirdim → returned)
  'none', // nothing to do (not the driver's turn / terminal)
] as const;
export type DriverNextActionKind = (typeof DRIVER_NEXT_ACTIONS)[number];

/** Statuses in which a driver is actively engaged with an order. */
export const ACTIVE_ORDER_STATUSES = [
  'assigned_to_driver',
  'driver_accepted',
  'collecting_items',
  'items_collected',
  'on_the_way',
  'arrived_at_customer',
  'returning',
] as const satisfies readonly OrderStatus[];

/**
 * Statuses in which a driver has accepted an order and is mid-delivery.
 * Excludes `assigned_to_driver` (not yet accepted — can still time out / be reassigned).
 * A driver may not go offline while any of their orders is in one of these states.
 */
export const IN_PROGRESS_ORDER_STATUSES = [
  'driver_accepted',
  'collecting_items',
  'items_collected',
  'on_the_way',
  'arrived_at_customer',
  'returning',
] as const satisfies readonly OrderStatus[];

/**
 * Active statuses that block a driver from taking ANOTHER order. This is
 * ACTIVE_ORDER_STATUSES minus `returning`: a driver may carry a pending return
 * (Vozrat) and still be assigned/accept the next order — the return is delivered
 * back later. (Note: `returning` still blocks going offline — see clock-out.)
 */
export const BLOCKING_ACTIVE_ORDER_STATUSES = [
  'assigned_to_driver',
  'driver_accepted',
  'collecting_items',
  'items_collected',
  'on_the_way',
  'arrived_at_customer',
] as const satisfies readonly OrderStatus[];

export const ORDER_PRIORITIES = ['normal', 'urgent'] as const;
export type OrderPriority = (typeof ORDER_PRIORITIES)[number];

export const ITEM_COLLECTION_STATUSES = ['pending', 'collected', 'problem'] as const;
export type ItemCollectionStatus = (typeof ITEM_COLLECTION_STATUSES)[number];

export const ASSIGNMENT_STATUSES = [
  'pending_driver_response',
  'accepted',
  'rejected',
  'cancelled',
  'completed',
] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const PICKUP_PLACE_TYPES = ['warehouse', 'market', 'custom'] as const;
export type PickupPlaceType = (typeof PICKUP_PLACE_TYPES)[number];

export const VEHICLE_TYPES = ['car', 'van', 'truck', 'motorcycle', 'other'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const VEHICLE_STATUSES = ['active', 'inactive', 'maintenance'] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const VEHICLE_DOC_TYPES = ['texosmotr', 'gas_inspection', 'insurance', 'power_of_attorney', 'tint', 'advertising_permit', 'other'] as const;
export type VehicleDocType = (typeof VEHICLE_DOC_TYPES)[number];

export const INCIDENT_TYPES = ['accident', 'breakdown', 'damage', 'other'] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

export const DRIVER_DOC_TYPES = ['license', 'power_of_attorney', 'insurance', 'other'] as const;
export type DriverDocType = (typeof DRIVER_DOC_TYPES)[number];

export const NOTIFICATION_CHANNELS = ['push', 'in_app'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const TELEGRAM_REPORT_STATUSES = ['pending', 'sent', 'failed'] as const;
export type TelegramReportStatus = (typeof TELEGRAM_REPORT_STATUSES)[number];

export const DEVICE_PLATFORMS = ['android', 'ios'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

/** Which orders a bonus rule applies to (by priority scope). */
export const BONUS_APPLIES_TO = ['all', 'urgent', 'normal'] as const;
export type BonusAppliesTo = (typeof BONUS_APPLIES_TO)[number];

/** Kind of driver leave/absence request (ruxsat). */
export const LEAVE_TYPES = ['sick', 'vacation', 'personal', 'other'] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

/** Approval state of a leave request. */
export const LEAVE_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

/** Seller reservation board — how a seller claimed a vehicle. */
export const BOOKING_KINDS = ['zanyat', 'bron'] as const;
export type BookingKind = (typeof BOOKING_KINDS)[number];

/** How much of the truck a single reservation claims. */
export const BOOKING_MODES = ['single', 'double', 'full'] as const;
export type BookingMode = (typeof BOOKING_MODES)[number];

/** Vehicle size class — drives the driver-pay tariffs and the seller-board grouping.
 *  katta = Isuzu · orta = Gazel 4m/6m · kichik = Van/Labo/Kombi.
 *  Board columns stay two: `katta` alone; `orta` + `kichik` share the light column. */
export const VEHICLE_CATEGORIES = ['katta', 'orta', 'kichik'] as const;
export type VehicleCategory = (typeof VEHICLE_CATEGORIES)[number];

/** Derived board status of a vehicle for sellers. */
export const BOARD_STATUSES = ['free', 'booked', 'full', 'offduty'] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];

/** Seven-colour vehicle-card state for the seller board, evaluated by precedence:
 *  blocked > excused > full > multi_load > one_load > available_working/idle.
 *  Colours: available_idle=muted green · available_working=bright green ·
 *  one_load=yellow · multi_load=dark yellow · full=dark orange · excused=black ·
 *  blocked=red. */
export const VEHICLE_CARD_STATES = [
  'available_idle', // available, work not started
  'available_working', // available, clocked in
  'one_load', // 1 active load
  'multi_load', // 2+ active loads
  'full', // fully occupied
  'excused', // on break / temporarily excused / on leave
  'blocked', // at the repair shop or a document issue
] as const;
export type VehicleCardState = (typeof VEHICLE_CARD_STATES)[number];

/** Why a card is red. The colour alone told the seller to leave the truck
 *  alone but not for how long or whose problem it is: a van at the repair shop
 *  is out for days, an expired texosmotr is an afternoon's errand, and a lorry
 *  taken off the fleet is neither. */
export const VEHICLE_BLOCK_REASONS = [
  'repair',
  'inactive',
  'license_expired',
  'documents',
  'missing_documents',
  'incomplete',
] as const;
/** The papers a lorry must hold to go out: without one, or past its date, the card is red. */
export const VEHICLE_REQUIRED_DOCS = ['texosmotr', 'insurance'] as const;
export type VehicleBlockReason = (typeof VEHICLE_BLOCK_REASONS)[number];

/** What a lorry must have on file before anyone books work onto it. Each one
 *  is something the office knows and nobody downstream can guess: what it can
 *  carry, what fits inside it, and what the driver is licensed to drive. */
/** The four photographs a seller may be asked to forward, by what they are of. */
export const FLEET_DOC_KINDS = ['tech_front', 'tech_back', 'license_front', 'license_back'] as const;
export type FleetDocKind = (typeof FLEET_DOC_KINDS)[number];
export const VEHICLE_REQUIRED_FIELDS = ['capacity', 'dimensions', 'license_category'] as const;
export type VehicleRequiredField = (typeof VEHICLE_REQUIRED_FIELDS)[number];

/** A driver's attendance outcome for one calendar day (Tashkent time).
 *  Resolved in priority order: day_off → on_leave → late/present → absent. */
export const ATTENDANCE_STATUSES = [
  'present', // clocked in on time
  'late', // clocked in after the shift start + grace
  'absent', // scheduled to work, no shift, no approved leave
  'on_leave', // covered by an approved leave request
  'day_off', // not a scheduled working day
  'not_started', // today, scheduled, shift not begun yet (not yet an absence)
] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
