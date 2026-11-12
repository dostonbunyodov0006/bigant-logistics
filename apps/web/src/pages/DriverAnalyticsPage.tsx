import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { DriverAnalytics, DriverAnalyticsRow } from '@bigant/shared';
import { api } from '../lib/api';
import { Card, DataTable, EmptyState, PageHeader, Spinner, type Column } from '../components/ui';
import { tkYm } from '../lib/tashkent';

function thisMonth(): string {
  const d = new Date();
  return tkYm(d);
}
function hours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
const som = (n: number) => n.toLocaleString('ru-RU');
function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A month of every driver side by side, busiest first. */
/** `embedded`: shown as a tab of Haydovchilar, which carries the heading. */
export function DriverAnalyticsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [month, setMonth] = useState(thisMonth());

  const { data, isLoading } = useQuery({
    queryKey: ['analytics', 'drivers', month],
    queryFn: () => api.get<DriverAnalytics>(`/analytics/drivers?month=${month}`),
    enabled: /^\d{4}-\d{2}$/.test(month),
  });

  const columns: Column<DriverAnalyticsRow>[] = [
    {
      key: 'driver',
      header: t('analytics.colDriver'),
      render: (r) => (
        <div>
          <div className="font-medium text-ink">{r.driver_name}</div>
          {r.vehicle_plate ? <div className="text-xs text-slate">{r.vehicle_plate}</div> : null}
        </div>
      ),
    },
    { key: 'delivered', header: t('analytics.colDelivered'), render: (r) => <span className="font-mono font-semibold text-ink">{r.delivered}</span> },
    {
      key: 'returns',
      header: t('analytics.colReturns'),
      render: (r) => (
        <span className={`font-mono ${r.returns > 0 ? 'text-brand-dark font-semibold' : 'text-slate'}`}>
          {r.returns}
          {r.return_items > 0 ? <span className="text-xs text-slate"> · {r.return_items}</span> : null}
        </span>
      ),
    },
    { key: 'shifts', header: t('analytics.colShifts'), render: (r) => <span className="font-mono text-slate">{r.shifts}</span> },
    { key: 'hours', header: t('analytics.colHours'), render: (r) => <span className="font-mono text-ink">{hours(r.worked_minutes)}</span> },
    {
      key: 'late',
      header: t('analytics.colLate'),
      render: (r) => (
        <span className={`font-mono ${r.late > 0 ? 'text-red-700 font-semibold' : 'text-slate'}`}>
          {r.late}
          {r.late_minutes > 0 ? <span className="text-xs text-slate"> · {r.late_minutes}m</span> : null}
        </span>
      ),
    },
    { key: 'early', header: t('analytics.colEarly'), render: (r) => <span className="font-mono text-slate">{r.early_leave}</span> },
    {
      key: 'fines',
      header: t('analytics.colFines'),
      render: (r) => (
        <span className={`font-mono ${r.fines > 0 ? 'text-red-700' : 'text-slate'}`}>
          {r.fines}
          {r.fines_amount > 0 ? <span className="text-xs text-slate"> · {som(r.fines_amount)}</span> : null}
        </span>
      ),
    },
  ];

  const downloadCsv = () => {
    if (!data) return;
    const header = [
      t('analytics.colDriver'), t('analytics.colVehicle'), t('analytics.colDelivered'), t('analytics.colReturns'),
      t('analytics.colReturnItems'), t('analytics.colShifts'), t('analytics.colHours'), t('analytics.colLate'),
      t('analytics.colLateMinutes'), t('analytics.colEarly'), t('analytics.colFines'), t('analytics.colFinesAmount'),
    ];
    const lines = [
      header.map(csvCell).join(','),
      ...data.rows.map((r) =>
        [r.driver_name, r.vehicle_plate ?? '', r.delivered, r.returns, r.return_items, r.shifts, (r.worked_minutes / 60).toFixed(1),
          r.late, r.late_minutes, r.early_leave, r.fines, r.fines_amount].map(csvCell).join(','),
      ),
    ];
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `drivers_${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totals = data?.totals;
  const tiles = [
    { label: t('analytics.tDelivered'), value: String(totals?.delivered ?? 0), fg: '#14181f' },
    { label: t('analytics.tReturns'), value: String(totals?.returns ?? 0), fg: '#b94e06' },
    { label: t('analytics.tLate'), value: String(totals?.late ?? 0), fg: '#b91c1c' },
    { label: t('analytics.tFines'), value: som(totals?.fines_amount ?? 0), fg: '#5b6470' },
  ];
  const hasRows = !!data && data.rows.length > 0;

  return (
    <div>
      {embedded ? (
        <div className="mb-4 flex justify-end">
          <button type="button" className="btn-ghost" disabled={!hasRows} onClick={downloadCsv}>
            {t('analytics.downloadCsv')}
          </button>
        </div>
      ) : (
        <PageHeader
          title={t('analytics.title')}
          actions={
            <button type="button" className="btn-ghost" disabled={!hasRows} onClick={downloadCsv}>
              {t('analytics.downloadCsv')}
            </button>
          }
        />
      )}

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="field-label" htmlFor="an-month">
              {t('analytics.month')}
            </label>
            <input id="an-month" type="month" className="input" value={month} max={thisMonth()} onChange={(e) => setMonth(e.target.value)} />
          </div>
        </div>
      </Card>

      {isLoading ? (
        <Card>
          <Spinner />
        </Card>
      ) : !hasRows ? (
        <Card>
          <EmptyState title={t('analytics.noData')} hint={t('analytics.noDataHint')} />
        </Card>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {tiles.map((tile) => (
              <Card key={tile.label} className="p-5">
                <div className="font-mono text-2xl font-semibold" style={{ color: tile.fg }}>
                  {tile.value}
                </div>
                <div className="mt-1 text-sm text-slate">{tile.label}</div>
              </Card>
            ))}
          </div>
          <Card>
            <DataTable columns={columns} rows={data.rows} keyOf={(r) => r.driver_id} onRowClick={(r) => navigate(`/drivers/${r.driver_id}`)} />
          </Card>
        </>
      )}
    </div>
  );
}
