import { useTranslation } from 'react-i18next';
import { useOrderEta } from '../lib/useOrderEta';

/**
 * The seller's two moments on one line: when the driver reaches *their*
 * pickup, and when the client gets the goods. Dark seller-board styling.
 *
 * Callers must only pass an order the driver is *currently* on (see
 * BoardVehicle.current_order_id): for anything queued behind another order
 * the route-from-here number would be an "if he left now" estimate, which is
 * worse than no number.
 */
export function SellerEta({
  orderId,
  className = '',
  // Green once he is driving to the client; amber while the order is his but
  // the wheels have not turned yet. The seller reads the colour before the
  // words.
  tone = 'waiting',
}: {
  orderId: string;
  className?: string;
  tone?: 'waiting' | 'moving';
}) {
  const { t } = useTranslation();
  const { data: eta } = useOrderEta(orderId);
  if (!eta || eta.state === 'unavailable' || !eta.next_stop) return null;

  const stale = eta.state === 'stale';
  const parts: string[] = [];
  if (eta.next_stop.kind === 'pickup') {
    parts.push(t('eta.toPickup', { min: minutes(eta.next_stop.eta_seconds) }));
  }
  if (eta.delivery) {
    parts.push(t('eta.toClient', { min: minutes(eta.delivery.eta_seconds), km: km(eta.delivery.distance_km) }));
  }

  return (
    <div
      className={`text-xs ${
        stale ? 'text-slate-light' : tone === 'moving' ? 'font-semibold text-free' : 'font-semibold text-booked'
      } ${className}`}
    >
      <span aria-hidden>🚚</span> {parts.join(' · ')}
      {stale && eta.driver_position && (
        // Its own line, not a bracket tacked on the end: the seller reads
        // the times first and the caveat about them second.
        <div className="mt-0.5 font-normal text-slate">
          {t('eta.lastSeen', { ago: t(...ago(eta.driver_position.age_seconds)) })}
        </div>
      )}
    </div>
  );
}

export function minutes(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}
export function km(value: number): string {
  return value < 10 ? value.toFixed(1) : String(Math.round(value));
}
/** Humanised age as a translation key + interpolation, so the caller keeps
 *  the strictly typed `t` (loosening it would defeat the missing-key check). */
export function ago(
  seconds: number,
): ['eta.justNow'] | ['eta.minutesAgo' | 'eta.hoursAgo' | 'eta.daysAgo', { n: number }] {
  if (seconds < 60) return ['eta.justNow'];
  if (seconds < 3600) return ['eta.minutesAgo', { n: Math.round(seconds / 60) }];
  if (seconds < 86_400) return ['eta.hoursAgo', { n: Math.round(seconds / 3600) }];
  return ['eta.daysAgo', { n: Math.round(seconds / 86_400) }];
}
