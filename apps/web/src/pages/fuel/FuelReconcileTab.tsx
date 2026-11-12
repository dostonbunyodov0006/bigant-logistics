import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FUEL_UNITS, type FuelLog, type FuelType } from '@bigant/shared';
import { api } from '../../lib/api';
import { Card, EmptyState, Spinner } from '../../components/ui';
import { day, downloadCsv, money, qty } from './fuelShared';
import type { Period } from '../FuelPage';

/**
 * The month as the stations will send it, so the two can be laid side by side.
 *
 * At the end of the month a station sends a sheet — plate, date, cubic metres,
 * driver — and an invoice with one total. This is our half of that comparison:
 * every fill we recorded, grouped by station and then by truck, added up at
 * each level. Type their total into the box and the difference appears; follow
 * it down the list to the line that disagrees, and the photograph on that log
 * settles who was right.
 *
 * Nothing is rounded along the way: these are the sums the drivers confirmed.
 */
export function FuelReconcileTab({ period }: { period: Period }) {
  const { t } = useTranslation();
  // What each station says it is owed, as typed off their invoice.
  const [claimed, setClaimed] = useState<Record<string, string>>({});

  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(period).filter(([, v]) => v)) as Record<string, string>,
  ).toString();
  const logsQ = useQuery({
    queryKey: ['fuel', 'reconcile', qs],
    // A month is routinely more than one page, and a sheet that stops at the
    // first 500 fills under-credits the station by exactly the rows it drops.
    queryFn: async () => {
      const page = 500;
      const all: FuelLog[] = [];
      for (let skip = 0; skip < 10_000; skip += page) {
        const batch = await api.get<FuelLog[]>(
          `/fuel/logs?${qs ? `${qs}&` : ''}skip=${skip}&take=${page}`,
        );
        all.push(...batch);
        if (batch.length < page) break;
      }
      return all;
    },
  });

  const stations = useMemo(
    () => groupByStation(logsQ.data ?? []),
    [logsQ.data],
  );
  const grandSum = stations.reduce((acc, s) => acc + s.sum, 0);

  const exportCsv = () => {
    downloadCsv(
      `zapravka-${period.from ?? ''}-${period.to ?? ''}.csv`,
      ['station', 'date', 'plate', 'driver', 'quantity', 'unit', 'unit_price', 'total'],
      stations.flatMap((station) =>
        station.vehicles.flatMap((vehicle) =>
          vehicle.rows.map((row) => [
            station.name,
            day(row.captured_at),
            vehicle.plate,
            row.driver_name,
            row.confirmed?.quantity,
            FUEL_UNITS[row.fuel_type as FuelType],
            row.confirmed?.unit_price_sum,
            row.confirmed?.total_sum,
          ]),
        ),
      ),
    );
  };

  if (logsQ.isLoading) return <Spinner />;
  if (stations.length === 0) return <EmptyState title={t('fuel.noLogs')} />;

  return (
    <div className="space-y-4">

      <div className="flex flex-wrap items-center justify-end gap-2 print:hidden">
        <button type="button" className="btn-ghost" onClick={exportCsv}>
          {t('fuel.reconcile.csv')}
        </button>
        <button type="button" className="btn-ghost" onClick={() => window.print()}>
          {t('fuel.reconcile.print')}
        </button>
      </div>

      {stations.map((station) => {
        const typed = claimed[station.id] ?? '';
        // An invoice is typed as it is printed: "4 200 000" or "4.200.000".
        // Everything that is not a digit is a separator here, because a
        // station's total is always whole so'm.
        const digits = typed.replace(/\D/g, '');
        const theirs = digits ? Number(digits) : null;
        // Compared at the rounding the screen shows, so a stray fraction of a
        // so'm is not reported as a disagreement.
        const diff =
          theirs != null ? Math.round(theirs) - Math.round(station.sum) : null;
        const unreadable = typed.trim().length > 0 && theirs == null;
        return (
          <Card key={station.id}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-mist px-5 py-3">
              <h3 className="font-display text-base font-bold">{station.name}</h3>
              <span className="text-sm text-slate">
                {t('fuel.reconcile.stationTotals', {
                  fills: station.fills,
                  volume: volumeLabel(station.volume),
                  sum: money(station.sum),
                })}
              </span>
            </div>

            {station.vehicles.map((vehicle) => (
              <div key={vehicle.key} className="border-b border-mist/60 last:border-0">
                <div className="flex flex-wrap items-baseline gap-x-3 bg-canvas px-5 py-2 text-sm">
                  <span className="font-mono font-semibold text-ink">{vehicle.plate}</span>
                  <span className="text-slate">{vehicle.driver}</span>
                  <span className="ml-auto font-mono text-ink">
                    {volumeLabel(vehicle.volume)} · {money(vehicle.sum)}
                  </span>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {vehicle.rows.map((row) => (
                      <tr key={row.id} className="border-t border-mist/40">
                        <td className="px-5 py-1.5 font-mono text-slate">{day(row.captured_at)}</td>
                        <td className="px-3 py-1.5 text-slate">{row.driver_name ?? '—'}</td>
                        <td className="px-3 py-1.5 text-right font-mono">
                          {qty(row.confirmed?.quantity ?? 0)}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-slate">
                          {money(row.confirmed?.unit_price_sum ?? 0)}
                        </td>
                        <td className="px-5 py-1.5 text-right font-mono font-semibold">
                          {money(row.confirmed?.total_sum ?? 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}

            <div className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <label className="flex items-center gap-2" htmlFor={`claim-${station.id}`}>
                <span className="text-slate">{t('fuel.reconcile.theirInvoice')}</span>
                <input
                  id={`claim-${station.id}`}
                  className="input w-40 font-mono"
                  inputMode="numeric"
                  value={typed}
                  onChange={(e) => setClaimed((c) => ({ ...c, [station.id]: e.target.value }))}
                />
              </label>
              <span className="font-mono text-slate">
                {t('fuel.reconcile.ours')}: {money(station.sum)}
              </span>
              {unreadable && (
                <span className="rounded-full bg-[#fdeaea] px-3 py-1 font-semibold text-[#dc2626]">
                  {t('fuel.reconcile.unreadable')}
                </span>
              )}
              {diff != null && (
                <span
                  className={`rounded-full px-3 py-1 font-mono font-bold ${
                    diff === 0 ? 'bg-[#dcfce7] text-[#166534]' : 'bg-[#fdeaea] text-[#dc2626]'
                  }`}
                >
                  {diff === 0
                    ? t('fuel.reconcile.match')
                    : t('fuel.reconcile.diff', {
                        sign: diff > 0 ? '+' : '−',
                        sum: money(Math.abs(diff)),
                      })}
                </span>
              )}
            </div>
          </Card>
        );
      })}

      <Card>
        <div className="flex flex-wrap items-baseline gap-x-3 px-5 py-3">
          <span className="font-display text-base font-bold">{t('fuel.reconcile.grand')}</span>
          <span className="ml-auto font-mono text-lg font-bold">{money(grandSum)}</span>
        </div>
      </Card>
    </div>
  );
}

type Volume = { nm3: number; l: number };
type VehicleGroup = {
  key: string;
  plate: string;
  driver: string;
  rows: FuelLog[];
  sum: number;
  volume: Volume;
};
type StationGroup = {
  id: string;
  name: string;
  fills: number;
  sum: number;
  volume: Volume;
  vehicles: VehicleGroup[];
};

/** "412 nm3", "88 l", or both when a station sells both. */
function volumeLabel(v: Volume): string {
  return [v.nm3 > 0 ? `${qty(v.nm3)} nm3` : null, v.l > 0 ? `${qty(v.l)} l` : null]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Station → truck → fills, with every level added up.
 *
 * Only what the station will actually invoice us for: a fill the driver paid
 * for himself, or one still waiting in the review queue, is not part of what
 * they are owed, and the station he *tapped* is not evidence — the fence
 * decides, so a fill that resolved to no station is not theirs either. This is
 * the same rule the settlement screen counts by, which is why the two now
 * agree.
 */
function groupByStation(logs: FuelLog[]): StationGroup[] {
  const byStation = new Map<string, StationGroup>();
  for (const log of logs) {
    if (!log.confirmed) continue;
    if (log.settlement !== 'station_invoice') continue;
    const station = log.resolved_station;
    if (!station) continue;
    const id = station.id;
    let group = byStation.get(id);
    if (!group) {
      group = {
        id,
        name: station.name,
        fills: 0,
        sum: 0,
        // Cubic metres and litres are different things and are never added
        // together — a station that sells both reports both.
        volume: { nm3: 0, l: 0 },
        vehicles: [],
      };
      byStation.set(id, group);
    }
    const plate = log.vehicle_plate ?? '—';
    let vehicle = group.vehicles.find((v) => v.key === plate);
    if (!vehicle) {
      vehicle = {
        key: plate,
        plate,
        driver: log.driver_name ?? '—',
        rows: [],
        sum: 0,
        volume: { nm3: 0, l: 0 },
      };
      group.vehicles.push(vehicle);
    }
    const unit = FUEL_UNITS[log.fuel_type as FuelType] === 'nm3' ? 'nm3' : 'l';
    vehicle.rows.push(log);
    vehicle.sum += log.confirmed.total_sum;
    vehicle.volume[unit] += log.confirmed.quantity;
    group.fills += 1;
    group.sum += log.confirmed.total_sum;
    group.volume[unit] += log.confirmed.quantity;
  }
  const groups = [...byStation.values()];
  for (const group of groups) {
    group.vehicles.sort((a, b) => a.plate.localeCompare(b.plate));
    for (const vehicle of group.vehicles) {
      vehicle.rows.sort((a, b) => a.captured_at.localeCompare(b.captured_at));
    }
  }
  return groups.sort((a, b) => b.sum - a.sum);
}
