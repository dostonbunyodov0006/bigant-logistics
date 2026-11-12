import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  FUEL_TYPES,
  type DriverPublic,
  type FuelLog,
  type FuelStation,
  type FuelSummary,
} from '@bigant/shared';
import { api } from '../../lib/api';
import { Card, DataTable, EmptyState, Spinner, type Column } from '../../components/ui';
import { FuelLogDetailModal } from './FuelLogDetailModal';
import {
  FlagTags,
  OutcomeChip,
  PayerCell,
  dayTime,
  downloadCsv,
  money,
  qty,
  useFuelLabels,
} from './fuelShared';
import type { Period } from '../FuelPage';

/** The ledger: every confirmed fill-up in the period, filterable, exportable. */
export function FuelLogsTab({ period, onPeriod }: { period: Period; onPeriod: (p: Period) => void }) {
  const { t } = useTranslation();
  const L = useFuelLabels();
  const [driver, setDriver] = useState('');
  const [station, setStation] = useState('');
  const [fuel, setFuel] = useState('');
  const [outcome, setOutcome] = useState('');
  const [open, setOpen] = useState<FuelLog | null>(null);

  const driversQ = useQuery({ queryKey: ['drivers'], queryFn: () => api.get<DriverPublic[]>('/drivers') });
  const stationsQ = useQuery({
    queryKey: ['fuel', 'stations', 'all'],
    queryFn: () => api.get<FuelStation[]>('/fuel/stations/all'),
  });

  const params = new URLSearchParams();
  if (driver) params.set('driver_id', driver);
  if (station) params.set('station_id', station);
  if (fuel) params.set('fuel_type', fuel);
  // One select, two kinds of answer: an outcome, or whose hand changed the numbers.
  if (outcome === 'edited_driver') params.set('edited', 'driver');
  else if (outcome === 'edited_office') params.set('edited', 'dispatcher');
  else if (outcome === 'edited_admin') params.set('edited', 'admin');
  else if (outcome) params.set('outcome', outcome);
  if (period.from) params.set('from', period.from);
  if (period.to) params.set('to', period.to);
  const qs = params.toString();

  const logsQ = useQuery({
    queryKey: ['fuel', 'logs', qs],
    queryFn: () => api.get<FuelLog[]>(`/fuel/logs${qs ? `?${qs}` : ''}`),
  });
  const periodQs = new URLSearchParams(
    Object.fromEntries(Object.entries(period).filter(([, v]) => v)) as Record<string, string>,
  ).toString();
  const summaryQ = useQuery({
    queryKey: ['fuel', 'summary', periodQs],
    queryFn: () => api.get<FuelSummary>(`/fuel/summary${periodQs ? `?${periodQs}` : ''}`),
  });

  const logs = logsQ.data ?? [];
  const s = summaryQ.data;

  const columns = useMemo<Column<FuelLog>[]>(
    () => [
      {
        key: 'date',
        header: t('fuel.colDate'),
        render: (l) => <span className="font-mono text-xs">{dayTime(l.captured_at)}</span>,
      },
      {
        key: 'driver',
        header: t('fuel.colDriver'),
        render: (l) => (
          <div>
            <div className="font-medium">{l.driver_name ?? '—'}</div>
            <div className="text-xs text-slate">
              {[l.vehicle_model, l.vehicle_plate].filter(Boolean).join(' · ')}
            </div>
          </div>
        ),
      },
      { key: 'fuel', header: t('fuel.colFuel'), render: (l) => L.fuel(l.fuel_type) },
      { key: 'station', header: t('fuel.colStation'), render: (l) => L.stationName(l) },
      {
        key: 'qty',
        header: t('fuel.colQuantity'),
        className: 'text-right',
        render: (l) => (
          <span className="font-mono">
            {l.confirmed ? `${qty(l.confirmed.quantity)} ${L.unit(l.fuel_type)}` : '—'}
          </span>
        ),
      },
      {
        key: 'price',
        header: t('fuel.colPrice'),
        className: 'text-right',
        render: (l) => <span className="font-mono text-slate">{l.confirmed ? money(l.confirmed.unit_price_sum) : '—'}</span>,
      },
      {
        key: 'total',
        header: t('fuel.colTotal'),
        className: 'text-right',
        render: (l) => <span className="font-mono font-semibold">{l.confirmed ? money(l.confirmed.total_sum) : '—'}</span>,
      },
      {
        key: 'status',
        header: t('fuel.colStatus'),
        render: (l) => (
          <div className="flex flex-col items-start gap-1">
            <OutcomeChip outcome={l.outcome} />
            <FlagTags flags={l.flags} />
            {/* Checked in the office: by whom, and whether the numbers were changed or approved as they stood. */}
            {l.original ? (
              <span className="rounded-full bg-[#eef2ff] px-2 py-0.5 text-[11px] font-semibold text-[#4338ca]">
                {t(l.reviewed_by_role === 'admin' ? 'fuel.correctedAdmin' : 'fuel.correctedOffice')}
              </span>
            ) : l.reviewed_by_name ? (
              <span className="rounded-full bg-[#e6f6ec] px-2 py-0.5 text-[11px] font-semibold text-[#15803d]">
                ✓ {t(l.reviewed_by_role === 'admin' ? 'fuel.approvedAdmin' : 'fuel.approvedOffice')}
              </span>
            ) : null}
          </div>
        ),
      },
      { key: 'payer', header: t('fuel.colPayer'), render: (l) => <PayerCell log={l} /> },
    ],
    [t, L],
  );

  const exportCsv = () =>
    downloadCsv(
      `fuel-${period.from ?? 'all'}-${period.to ?? 'all'}.csv`,
      ['date', 'driver', 'vehicle', 'fuel', 'station', 'quantity', 'unit', 'unit_price', 'total', 'outcome', 'flags', 'settlement', 'settled_at', 'photo'],
      logs.map((l) => [
        l.captured_at,
        l.driver_name,
        l.vehicle_plate,
        l.fuel_type,
        L.stationName(l),
        l.confirmed?.quantity,
        l.unit,
        l.confirmed?.unit_price_sum,
        l.confirmed?.total_sum,
        l.outcome,
        l.flags.join(' '),
        l.settlement,
        l.settled_at,
        l.photo_url,
      ]),
    );

  return (
    <>
      <div className="mb-4 flex justify-end">
        <button type="button" className="btn-ghost" disabled={logs.length === 0} onClick={exportCsv}>
          {t('fuel.downloadCsv')}
        </button>
      </div>

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div>
            <label className="field-label" htmlFor="fl-driver">{t('fuel.filterDriver')}</label>
            <select id="fl-driver" className="input" value={driver} onChange={(e) => setDriver(e.target.value)}>
              <option value="">{t('fuel.all')}</option>
              {driversQ.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="fl-station">{t('fuel.filterStation')}</label>
            <select id="fl-station" className="input" value={station} onChange={(e) => setStation(e.target.value)}>
              <option value="">{t('fuel.all')}</option>
              {stationsQ.data?.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="fl-fuel">{t('fuel.filterFuel')}</label>
            <select id="fl-fuel" className="input" value={fuel} onChange={(e) => setFuel(e.target.value)}>
              <option value="">{t('fuel.all')}</option>
              {FUEL_TYPES.map((f) => <option key={f} value={f}>{L.fuel(f)}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="fl-outcome">{t('fuel.filterOutcome')}</label>
            <select id="fl-outcome" className="input" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              {/* Shown in the closed box; listed only once a status is picked, to go back. */}
              <option value="" hidden={outcome === ''}>{t('fuel.all')}</option>
              <option value="matched">{t('fuel.outcome.matched')}</option>
              <option value="unlisted">{t('fuel.outcome.unlisted')}</option>
              <option value="edited_driver">{t('fuel.editedDriver')}</option>
              <option value="edited_office">{t('fuel.editedOffice')}</option>
              <option value="edited_admin">{t('fuel.editedAdmin')}</option>
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="fl-from">{t('fuel.from')}</label>
            <input id="fl-from" type="date" className="input" value={period.from} max={period.to} onChange={(e) => onPeriod({ ...period, from: e.target.value })} />
          </div>
          <div>
            <label className="field-label" htmlFor="fl-to">{t('fuel.to')}</label>
            <input id="fl-to" type="date" className="input" value={period.to} min={period.from} onChange={(e) => onPeriod({ ...period, to: e.target.value })} />
          </div>
        </div>
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="p-5">
          <div className="font-mono text-2xl font-semibold text-ink">{money(s?.total_sum ?? 0)}</div>
          <div className="mt-1 text-sm text-slate">{t('fuel.tileTotal')}</div>
        </Card>
        <Card className="p-5">
          <div className="font-mono text-2xl font-semibold text-brandDark">{qty(s?.volume_nm3 ?? 0)} Nm³</div>
          <div className="mt-1 text-sm text-slate">{t('fuel.tileVolume')}</div>
          {s && s.volume_l > 0 && (
            <div className="text-xs text-slate-light">{t('fuel.tileVolumeSub', { l: qty(s.volume_l) })}</div>
          )}
        </Card>
        <Card className="p-5">
          <div className="font-mono text-2xl font-semibold text-ink">{s?.count ?? 0}</div>
          <div className="mt-1 text-sm text-slate">{t('fuel.tileCount')}</div>
          {s && <div className="text-xs text-slate-light">{t('fuel.tileCountSub', { drivers: s.drivers, stations: s.stations })}</div>}
        </Card>
        <Card className="p-5">
          <div className={`font-mono text-2xl font-semibold ${s?.pending_review ? 'text-[#dc2626]' : 'text-ink'}`}>
            {s?.pending_review ?? 0}
          </div>
          <div className="mt-1 text-sm text-slate">{t('fuel.tilePending')}</div>
        </Card>
      </div>

      <Card>
        {logsQ.isLoading ? (
          <Spinner />
        ) : logs.length === 0 ? (
          <EmptyState title={t('fuel.noLogs')} hint={t('fuel.noLogsHint')} />
        ) : (
          <DataTable columns={columns} rows={logs} keyOf={(l) => l.id} onRowClick={setOpen} />
        )}
      </Card>

      <FuelLogDetailModal log={open} onClose={() => setOpen(null)} />
    </>
  );
}
