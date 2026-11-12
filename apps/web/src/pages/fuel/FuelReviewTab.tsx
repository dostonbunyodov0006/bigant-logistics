import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { FuelLog } from '@bigant/shared';
import { api } from '../../lib/api';
import { Card, EmptyState, Spinner } from '../../components/ui';
import { FuelLogDetailModal } from './FuelLogDetailModal';
import { OutcomeChip, dayTime, metres, money, qty, useFuelLabels } from './fuelShared';

/**
 * The queue: confirmed fill-ups with no settlement. Each row says in one line
 * why the server could not decide. Who pays is never picked by hand here: the
 * location decides it, and saving the numbers in the log window releases it.
 */
export function FuelReviewTab() {
  const { t } = useTranslation();
  const L = useFuelLabels();
  const [open, setOpen] = useState<FuelLog | null>(null);

  const q = useQuery({
    queryKey: ['fuel', 'logs', 'review'],
    queryFn: () => api.get<FuelLog[]>('/fuel/logs?settlement_state=pending'),
  });
  const why = (l: FuelLog): string => {
    const picked = l.selected_station?.name;
    // The fence may be happy; it is the numbers that are in doubt.
    if (l.outcome === 'matched' || l.outcome === 'other_station' || l.outcome === 'unlisted') {
      if (l.flags.includes('driver_edited') && l.extracted && l.confirmed) {
        const e = l.extracted;
        const c = l.confirmed;
        return t('fuel.review.whyEdited', {
          ai: `${money(e.total_sum)} · ${qty(e.quantity)} · ${money(e.unit_price_sum)}`,
          driver: `${money(c.total_sum)} · ${qty(c.quantity)} · ${money(c.unit_price_sum)}`,
        });
      }
      if (l.flags.includes('arithmetic_off') && l.confirmed) {
        const c = l.confirmed;
        return t('fuel.review.whyArithmetic', { q: qty(c.quantity), p: money(c.unit_price_sum), t: money(c.quantity * c.unit_price_sum), entered: money(c.total_sum) });
      }
      if (l.flags.includes('unit_mismatch')) return t('fuel.review.whyUnit', { fuel: L.fuel(l.fuel_type) });
    }
    if (l.outcome === 'mismatch') {
      return (
        t('fuel.review.whyMismatch', { station: picked ?? '—', d: l.distance_m != null ? metres(l.distance_m) : '?' }) +
        (l.flags.includes('tracking_disagrees') ? t('fuel.review.whyMismatchTracker') : '')
      );
    }
    return picked ? t('fuel.review.whyUnverifiedPicked', { station: picked }) : t('fuel.review.whyUnverifiedStreet');
  };

  const rows = q.data ?? [];

  return (
    <>

      {q.isLoading ? (
        <Card><Spinner /></Card>
      ) : rows.length === 0 ? (
        <Card><EmptyState title={t('fuel.review.empty')} hint={t('fuel.review.emptyHint')} /></Card>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((l) => (
            <Card key={l.id} className="p-4">
              <div className="flex flex-wrap items-center gap-4">
                <button type="button" onClick={() => setOpen(l)} className="h-20 w-20 flex-none overflow-hidden rounded-lg bg-[#2a2d33]">
                  <img src={l.photo_url} alt="" className="h-full w-full object-cover" />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="font-semibold">{l.driver_name ?? '—'} · {l.vehicle_plate ?? ''}</span>
                    <span className="font-mono text-xs text-slate">{dayTime(l.captured_at)}</span>
                    <OutcomeChip outcome={l.outcome} />
                  </div>
                  <div className="mt-1 text-sm">{why(l)}</div>
                  <div className="mt-1 text-xs text-slate">
                    {t('fuel.review.picked')}: <b className="text-ink">{l.selected_station?.name ?? t('fuel.street')}</b>
                    {' · '}
                    {L.fuel(l.fuel_type)}
                    {l.confirmed && (
                      <>
                        {' · '}
                        <span className="font-mono">{qty(l.confirmed.quantity)} {L.unit(l.fuel_type)} · {money(l.confirmed.total_sum)} so'm</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex flex-none flex-col items-stretch gap-2">
                  <button type="button" className="btn-primary" onClick={() => setOpen(l)}>
                    {t('fuel.review.open')}
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <FuelLogDetailModal log={open} onClose={() => setOpen(null)} />
    </>
  );
}
