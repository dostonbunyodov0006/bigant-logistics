import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { FuelDriverDebt, FuelLog, FuelStationTotal } from '@bigant/shared';
import { api } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';
import { Card, EmptyState, Spinner } from '../../components/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { day, downloadCsv, money, qty } from './fuelShared';
import type { Period } from '../FuelPage';

/**
 * Month-end. Left: what each station should be invoicing us, to hold against
 * the invoice it actually sends. Right: what each driver is owed for fills
 * they paid for, and the one button that closes it.
 */
export function FuelSettleTab({ period }: { period: Period }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [paying, setPaying] = useState<FuelDriverDebt | null>(null);
  const [lastPaid, setLastPaid] = useState<{ paid: number; total_sum: number } | null>(null);

  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(period).filter(([, v]) => v)) as Record<string, string>,
  ).toString();
  const stationsQ = useQuery({
    queryKey: ['fuel', 'settlement', 'stations', qs],
    queryFn: () => api.get<FuelStationTotal[]>(`/fuel/settlement/stations${qs ? `?${qs}` : ''}`),
  });
  const debtsQ = useQuery({
    queryKey: ['fuel', 'settlement', 'drivers'],
    queryFn: () => api.get<FuelDriverDebt[]>('/fuel/settlement/drivers'),
  });
  const payM = useMutation({
    mutationFn: (driverId: string) =>
      api.post<{ paid: number; total_sum: number }>(`/fuel/settlement/drivers/${driverId}/pay`, {}),
    onSuccess: (res) => {
      setLastPaid(res);
      setPaying(null);
      void queryClient.invalidateQueries({ queryKey: ['fuel'] });
    },
  });

  const stationCsv = async (row: FuelStationTotal) => {
    const p = new URLSearchParams({
      station_id: row.station.id,
      ...(period.from ? { from: period.from } : {}),
      ...(period.to ? { to: period.to } : {}),
    });
    const logs = await api.get<FuelLog[]>(`/fuel/logs?${p.toString()}`);
    downloadCsv(
      `fuel-${row.station.name.replace(/\W+/g, '_')}-${period.from ?? ''}-${period.to ?? ''}.csv`,
      ['date', 'driver', 'vehicle', 'fuel', 'quantity', 'unit', 'unit_price', 'total', 'photo'],
      logs.map((l) => [
        l.captured_at,
        l.driver_name,
        l.vehicle_plate,
        l.fuel_type,
        l.confirmed?.quantity,
        l.unit,
        l.confirmed?.unit_price_sum,
        l.confirmed?.total_sum,
        l.photo_url,
      ]),
    );
  };

  const debts = debtsQ.data ?? [];

  return (
    <>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-baseline gap-2.5 px-5 pt-4">
            <h3 className="font-display text-base font-bold">{t('fuel.settle.stationsTitle')}</h3>
            <span className="text-xs text-slate">{t('fuel.settle.stationsSub')}</span>
          </div>
          {stationsQ.isLoading ? (
            <Spinner />
          ) : (stationsQ.data ?? []).length === 0 ? (
            <EmptyState title={t('fuel.settle.stationsEmpty')} />
          ) : (
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="border-b border-mist text-left text-xs uppercase tracking-wide text-slate-light">
                  <th className="px-5 py-2 font-medium">{t('fuel.colStation')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('fuel.settle.colFills')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('fuel.settle.colVolume')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('fuel.settle.colSum')}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {stationsQ.data!.map((r) => (
                  <tr key={r.station.id} className="border-b border-mist last:border-0">
                    <td className="px-5 py-2.5 font-medium">{r.station.name}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{r.count}</td>
                    <td className="px-3 py-2.5 text-right font-mono">
                      {r.volume_nm3 > 0 && `${qty(r.volume_nm3)} Nm³`}
                      {r.volume_nm3 > 0 && r.volume_l > 0 && ' · '}
                      {r.volume_l > 0 && `${qty(r.volume_l)} l`}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold">
                      {money(r.total_sum)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => void stationCsv(r)}
                      >
                        CSV
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card>
          <div className="flex items-baseline gap-2.5 px-5 pt-4">
            <h3 className="font-display text-base font-bold">{t('fuel.settle.driversTitle')}</h3>
            <span className="text-xs text-slate">{t('fuel.settle.driversSub')}</span>
          </div>
          {debtsQ.isLoading ? (
            <Spinner />
          ) : debts.length === 0 ? (
            <EmptyState title={t('fuel.settle.driversEmpty')} />
          ) : (
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="border-b border-mist text-left text-xs uppercase tracking-wide text-slate-light">
                  <th className="px-5 py-2 font-medium">{t('fuel.settle.colDriver')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('fuel.settle.colFills')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('fuel.settle.colOldest')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('fuel.settle.colSum')}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {debts.map((d) => (
                  <tr
                    key={d.driver_id}
                    className="cursor-pointer border-b border-mist last:border-0 hover:bg-mist/40"
                    onClick={() => navigate(`/fuel/refund/${d.driver_id}`)}
                  >
                    <td className="px-5 py-2.5">
                      <div className="font-medium">{d.driver_name ?? '—'}</div>
                      <div className="text-xs text-slate">{d.vehicle_plate ?? ''}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono">{d.count}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-slate">
                      {day(d.oldest_at)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold">
                      {money(d.total_sum)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPaying(d);
                        }}
                      >
                        {t('fuel.settle.pay')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {lastPaid && (
        <div className="mt-4 rounded-lg bg-[#e6f6ec] px-4 py-2.5 text-sm font-medium text-[#15803d]">
          {t('fuel.settle.paid', { count: lastPaid.paid, sum: money(lastPaid.total_sum) })}
        </div>
      )}

      <ConfirmDialog
        open={!!paying}
        title={t('fuel.settle.payConfirmTitle')}
        message={
          paying
            ? t('fuel.settle.payConfirm', {
                name: paying.driver_name ?? '—',
                count: paying.count,
                sum: money(paying.total_sum),
              })
            : ''
        }
        pending={payM.isPending}
        error={payM.isError ? payM.error : undefined}
        onClose={() => setPaying(null)}
        onConfirm={() => paying && payM.mutate(paying.driver_id)}
        confirmLabel={t('fuel.settle.pay')}
      />
    </>
  );
}
