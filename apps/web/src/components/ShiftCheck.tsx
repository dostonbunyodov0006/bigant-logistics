import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { CarryOverReason, ShiftAlerts } from '@bigant/shared';
import { api } from '../lib/api';
import { Card } from './ui';
import { TZ } from '../lib/tashkent';

const CLOSE_SOURCES = ['auto_no_answer', 'auto_stale', 'auto_returned', 'auto_in_city', 'end_check_stop'] as const;
type KnownCloseSource = (typeof CLOSE_SOURCES)[number];
export function isKnownCloseSource(s: string | null): s is KnownCloseSource {
  return !!s && (CLOSE_SOURCES as readonly string[]).includes(s);
}

/** Full class names, so Tailwind keeps them: one column per card shown. */
const COLS = ['', 'lg:grid-cols-1', 'lg:grid-cols-2', 'lg:grid-cols-3', 'lg:grid-cols-4', 'lg:grid-cols-3'];

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
}
function dayTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "Sabab — izoh", the way the driver gave it. */
export function useCarryReason() {
  const { t } = useTranslation();
  return (reason: CarryOverReason, comment: string | null) =>
    [t(`shiftCheck.reasons.${reason}`), comment].filter(Boolean).join(' — ');
}

/**
 * "Kechadan qolgan": the driver ended his shift with this order and it goes
 * out the next day. Shown on the order wherever the seller or admin sees it.
 */
export function CarriedOverNote({
  carried,
  compact = false,
}: {
  carried: { reason: CarryOverReason; comment: string | null; at: string } | null;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const why = useCarryReason();
  if (!carried) return null;
  if (compact) {
    return (
      <span
        title={`${t('shiftCheck.leftOverHint')} ${why(carried.reason, carried.comment)}`}
        className="inline-flex items-center rounded-full bg-[#fef6e7] px-2 py-0.5 text-[11px] font-semibold text-[#a15c07]"
      >
        {t('shiftCheck.leftOver')}
      </span>
    );
  }
  return (
    <div className="rounded-lg border border-[#f5d28e] bg-[#fef6e7] px-3 py-2 text-sm text-[#7c4a03]">
      <span className="font-semibold">{t('shiftCheck.leftOver')}</span>
      <span className="text-[#a15c07]"> · {dayTime(carried.at)}</span>
      <div className="mt-0.5">{why(carried.reason, carried.comment)}</div>
    </div>
  );
}

/**
 * What the end-of-day check leaves for admin: drivers still on shift in the
 * regions (the check skips them), shifts the system closed, and orders moved
 * to tomorrow that are still open. Renders nothing when all three are empty.
 */
export function ShiftAlertsCard() {
  const { t } = useTranslation();
  const why = useCarryReason();
  const { data } = useQuery({
    queryKey: ['drivers', 'shift-alerts'],
    queryFn: () => api.get<ShiftAlerts>('/drivers/shift-alerts'),
    refetchInterval: 120_000,
  });
  if (!data) return null;
  // The per-km Viloyat card is gone (owner, 07.11.2026): the evening is paid by the hour.
  const { viloyat, auto_closed, carried_over } = data;
  const silent = data.silent ?? [];
  const shown = [silent, viloyat, auto_closed, carried_over].filter((list) => list.length > 0).length;
  if (shown === 0) return null;

  return (
    <div className="mt-6">
      <h2 className="mb-3 font-display text-lg font-semibold">{t('shiftCheck.alertsTitle')}</h2>
      <div className={`grid gap-4 ${COLS[shown]}`}>
        {silent.length > 0 && (
          <Card className="p-4">
            <div className="mb-2 text-sm font-semibold text-[#b42318]">{t('shiftCheck.alertsSilent')}</div>
            <div className="divide-y divide-mist/60">
              {silent.map((g) => (
                <Link
                  key={g.work_log_id}
                  to={`/drivers/${g.driver_id}`}
                  className="flex items-center justify-between gap-3 py-2 hover:text-brand"
                >
                  <span className="font-medium">{g.name}</span>
                  <span className="font-mono text-xs text-slate">
                    {t('shiftCheck.silentFor', {
                      min: g.minutes,
                      from: timeOf(g.longest_from),
                      to: timeOf(g.longest_to),
                    })}
                  </span>
                </Link>
              ))}
            </div>
          </Card>
        )}
        {viloyat.length > 0 && (
          <Card className="p-4">
            <div className="text-sm font-semibold text-ink">{t('shiftCheck.alertsViloyat')}</div>
            <div className="divide-y divide-mist/60">
              {viloyat.map((v) => (
                <Link
                  key={v.work_log_id}
                  to={`/drivers/${v.driver_id}`}
                  className="flex items-center justify-between gap-3 py-2 hover:text-brand"
                >
                  <span className="font-medium">{v.name}</span>
                  <span className="font-mono text-xs text-slate">
                    {t('shiftCheck.since', { time: dayTime(v.clock_in_at) })}
                  </span>
                </Link>
              ))}
            </div>
          </Card>
        )}
        {auto_closed.length > 0 && (
          <Card className="p-4">
            <div className="mb-2 text-sm font-semibold text-ink">
              {t('shiftCheck.alertsAutoClosed')}
            </div>
            <div className="divide-y divide-mist/60">
              {auto_closed.map((a) => (
                <Link
                  key={a.work_log_id}
                  to={`/drivers/${a.driver_id}`}
                  className="block py-2 hover:text-brand"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{a.name}</span>
                    <span className="font-mono text-xs text-slate">
                      {t('shiftCheck.closedAt', {
                        from: timeOf(a.clock_in_at),
                        to: timeOf(a.clock_out_at),
                      })}
                    </span>
                  </div>
                  {isKnownCloseSource(a.close_source) && (
                    <div className="mt-0.5 text-xs text-slate">
                      {t(`shiftCheck.closeSource.${a.close_source}`)}
                    </div>
                  )}
                </Link>
              ))}
            </div>
          </Card>
        )}
        {carried_over.length > 0 && (
          <Card className="p-4">
            <div className="mb-2 text-sm font-semibold text-ink">
              {t('shiftCheck.alertsCarried')}
            </div>
            <div className="divide-y divide-mist/60">
              {carried_over.map((c) => (
                <Link
                  key={`${c.order_id}-${c.at}`}
                  to={`/orders/${c.order_id}`}
                  className="block py-2 hover:text-brand"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{c.name}</span>
                    <span className="text-sm text-slate">· {c.client_name}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-[#a15c07]">{why(c.reason, c.comment)}</div>
                </Link>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
