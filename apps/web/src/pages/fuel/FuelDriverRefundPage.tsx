import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { FuelDriverDebt, FuelLog } from '@bigant/shared';
import { api } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';
import { Card, EmptyState, ErrorNote, PageHeader, Spinner } from '../../components/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { FuelLogDetailModal } from './FuelLogDetailModal';
import { day, dayTime, money, qty, useFuelLabels } from './fuelShared';

/**
 * One driver's money to be paid back: the total on top, every fill behind it
 * below. Opened from Hisob-kitob › Haydovchilarga qaytarish.
 */
export function FuelDriverRefundPage() {
  const { t } = useTranslation();
  const L = useFuelLabels();
  const navigate = useNavigate();
  const { driverId = '' } = useParams();
  const [open, setOpen] = useState<FuelLog | null>(null);
  const [paying, setPaying] = useState(false);
  // Rows paid on this page vanish at once, before the server has answered.
  const [gone, setGone] = useState<Set<string>>(new Set());
  const back = () => navigate('/fuel?tab=settle');

  const debtsQ = useQuery({
    queryKey: ['fuel', 'settlement', 'drivers'],
    queryFn: () => api.get<FuelDriverDebt[]>('/fuel/settlement/drivers'),
  });
  const fillsQ = useQuery({
    queryKey: ['fuel', 'settlement', 'driverFills', driverId],
    queryFn: () =>
      api.get<FuelLog[]>(
        `/fuel/logs?settlement_state=unpaid&driver_id=${encodeURIComponent(driverId)}`,
      ),
  });
  const payM = useMutation({
    mutationFn: () =>
      api.post<{ paid: number; total_sum: number }>(`/fuel/settlement/drivers/${driverId}/pay`, {}),
    onSuccess: () => {
      setPaying(false);
      void queryClient.invalidateQueries({ queryKey: ['fuel'] });
      back();
    },
  });

  const payOneM = useMutation({
    mutationFn: (id: string) =>
      api.post<{ paid: number; total_sum: number }>(`/fuel/logs/${id}/pay`, {}),
    onMutate: (id) => setGone((cur) => new Set(cur).add(id)),
    onError: (_e, id) =>
      setGone((cur) => {
        const next = new Set(cur);
        next.delete(id);
        return next;
      }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['fuel'] }),
  });

  const debt = (debtsQ.data ?? []).find((d) => d.driver_id === driverId) ?? null;
  const fills = (fillsQ.data ?? [])
    .filter((l) => l.settlement === 'driver_reimbursement' && !gone.has(l.id))
    .sort((a, b) => a.captured_at.localeCompare(b.captured_at));
  const name = debt?.driver_name ?? fills[0]?.driver_name ?? '…';

  return (
    <div>
      <button
        type="button"
        onClick={back}
        className="mb-3 text-sm font-medium text-slate hover:text-ink"
      >
        ← {t('common.back')}
      </button>

      <PageHeader
        title={name}
        subtitle={debt?.vehicle_plate ?? fills[0]?.vehicle_plate ?? undefined}
        actions={
          debt ? (
            <button type="button" className="btn-primary" onClick={() => setPaying(true)}>
              {t('fuel.settle.pay')}
            </button>
          ) : undefined
        }
      />

      {debt && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Card className="px-5 py-4">
            <div className="text-xs uppercase tracking-wide text-slate-light">
              {t('fuel.settle.colFills')}
            </div>
            <div className="mt-1 font-mono text-2xl font-semibold">{debt.count}</div>
          </Card>
          <Card className="px-5 py-4">
            <div className="text-xs uppercase tracking-wide text-slate-light">
              {t('fuel.settle.colOldest')}
            </div>
            <div className="mt-1 font-mono text-2xl font-semibold">{day(debt.oldest_at)}</div>
          </Card>
          <Card className="px-5 py-4">
            <div className="text-xs uppercase tracking-wide text-slate-light">
              {t('fuel.settle.totalOwed')}
            </div>
            <div className="mt-1 font-mono text-2xl font-semibold text-brandDark">
              {money(debt.total_sum)} so'm
            </div>
          </Card>
        </div>
      )}

      <Card>
        {fillsQ.isLoading || debtsQ.isLoading ? (
          <Spinner />
        ) : fills.length === 0 ? (
          <EmptyState title={t('fuel.settle.driversEmpty')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-mist text-left text-xs uppercase tracking-wide text-slate-light">
                  <th className="px-5 py-2.5 font-medium">{t('fuel.colDate')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('fuel.colDriver')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('fuel.colStation')}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{t('fuel.colQuantity')}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{t('fuel.colPrice')}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{t('fuel.colTotal')}</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {fills.map((l) => (
                  <tr
                    key={l.id}
                    className="cursor-pointer border-b border-mist last:border-0 hover:bg-mist/40"
                    onClick={() => setOpen(l)}
                  >
                    <td className="px-5 py-3 font-mono">{dayTime(l.captured_at)}</td>
                    <td className="px-3 py-3">
                      <div className="font-medium">{l.driver_name ?? '—'}</div>
                      <div className="text-xs text-slate">{l.vehicle_plate ?? ''}</div>
                    </td>
                    <td className="px-3 py-3 text-slate">{t('fuel.outcome.unlisted')}</td>
                    <td className="px-3 py-3 text-right font-mono">
                      {l.confirmed ? `${qty(l.confirmed.quantity)} ${L.unit(l.fuel_type)}` : '—'}
                    </td>
                    <td className="px-3 py-3 text-right font-mono">
                      {l.confirmed ? money(l.confirmed.unit_price_sum) : '—'}
                    </td>
                    <td className="px-3 py-3 text-right font-mono font-semibold">
                      {l.confirmed ? money(l.confirmed.total_sum) : '—'}
                    </td>
                    <td className="px-5 py-2 text-right">
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          payOneM.mutate(l.id);
                        }}
                      >
                        {t('fuel.settle.pay')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {payOneM.isError && <ErrorNote error={payOneM.error} />}

      <FuelLogDetailModal log={open} onClose={() => setOpen(null)} />

      <ConfirmDialog
        open={paying}
        title={t('fuel.settle.payConfirmTitle')}
        message={
          debt
            ? t('fuel.settle.payConfirm', {
                name: debt.driver_name ?? '—',
                count: debt.count,
                sum: money(debt.total_sum),
              })
            : ''
        }
        pending={payM.isPending}
        error={payM.isError ? payM.error : undefined}
        onClose={() => setPaying(false)}
        onConfirm={() => payM.mutate()}
        confirmLabel={t('fuel.settle.pay')}
      />
    </div>
  );
}
