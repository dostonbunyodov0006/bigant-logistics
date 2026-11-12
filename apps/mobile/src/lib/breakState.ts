import type { DriverMe } from '@bigant/shared';

/**
 * Whether the driver is on a break *right now*, and whether one is set for
 * later. A break saved at 16:12 for 16:30–17:30 is planned until half past:
 * the switch stays green and the day goes on; at 16:30 it becomes the break.
 */

export function breakState(
  driver: DriverMe | null | undefined,
  now = Date.now(),
): 'none' | 'planned' | 'running' | 'lapsed' {
  if (!driver?.break_until) return 'none';
  const until = new Date(driver.break_until).getTime();
  // Its end has passed and he is not back yet (owner, 12.11.2026): back to work, or longer.
  // No limit (owner, 12.11.2026): away until he presses Ish boshlandi; the
  // server clears it then, or with an order, or at the shift's end.
  if (until <= now) return 'lapsed';
  const from = driver.break_started_at ? new Date(driver.break_started_at).getTime() : 0;
  return from > now ? 'planned' : 'running';
}
