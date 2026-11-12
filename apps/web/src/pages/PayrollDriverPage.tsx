import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { PayrollDriverDetail, PayrollEntry } from '@bigant/shared';
import { api } from '../lib/api';
import { TZ } from '../lib/tashkent';
import { Card, DataTable, EmptyState, ErrorNote, PageHeader, Spinner, type Column } from '../components/ui';
import { PeriodPicker, saveXlsx, usePeriodParam } from './PayrollPage';

type Tab = 'pickups' | 'deliveries' | 'overtime';

const money = (n: number) => n.toLocaleString('ru-RU');
const day = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { timeZone: TZ });
const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '—';

/** One driver's bonuses for the period: three buttons side by side, each opening its own list. */
export function PayrollDriverPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { driverId } = useParams<{ driverId: string }>();
  const [period, setPeriod] = usePeriodParam();
  const [tab, setTab] = useState<Tab>('pickups');
  const qs = `from=${period.from}&to=${period.to}`;

  const { data, isLoading } = useQuery({
    queryKey: ['payroll', 'driver', driverId, qs],
    queryFn: () => api.get<PayrollDriverDetail>(`/payroll/drivers/${driverId}?${qs}`),
    enabled: !!driverId,
  });

  // His own workbook, as the mini app's personal file: Ишбай, Юк олиш, Юк топшириш.
  const excelM = useMutation({
    mutationFn: () => api.get<{ filename: string; base64: string }>(`/payroll/drivers/${driverId}/export?${qs}`),
    onSuccess: saveXlsx,
  });

  const total = (rows: PayrollEntry[] | undefined) => (rows ?? []).reduce((s, r) => s + r.amount_som, 0);
  const tabs: { key: Tab; label: string; rows: PayrollEntry[] }[] = [
    { key: 'pickups', label: t('payroll.pickup'), rows: data?.pickups ?? [] },
    { key: 'deliveries', label: t('payroll.delivery'), rows: data?.deliveries ?? [] },
    { key: 'overtime', label: t('payroll.overtime'), rows: data?.overtime ?? [] },
  ];
  const current = tabs.find((x) => x.key === tab)!;
  const name = data?.driver_name ?? '—';

  const trips: Column<PayrollEntry>[] = [
    { key: 'date', header: t('payroll.colDate'), render: (r) => <span className="font-mono">{day(r.at)}</span> },
    { key: 'time', header: t('payroll.colTime'), render: (r) => <span className="font-mono">{time(r.at)}</span> },
    { key: 'driver', header: t('payroll.colDriver'), render: () => <span className="text-ink">{name}</span> },
    {
      key: 'place',
      header: tab === 'pickups' ? t('payroll.colPlace') : t('payroll.colClient'),
      render: (r) => <span className="text-slate">{r.place ?? '—'}</span>,
    },
    {
      key: 'area',
      header: t('payroll.colArea'),
      render: (r) => <span className="text-slate">{r.kind.endsWith('outside') ? t('payroll.outside') : t('payroll.city')}</span>,
    },
    { key: 'tariff', header: t('payroll.colTariff'), className: 'text-right', render: (r) => <span className="font-mono text-slate">{r.tariff_som != null ? money(r.tariff_som) : '—'}</span> },
    { key: 'price', header: t('payroll.colPrice'), className: 'text-right', render: (r) => <span className="font-mono font-semibold text-ink">{money(r.amount_som)}</span> },
  ];
  const hours: Column<PayrollEntry>[] = [
    { key: 'date', header: t('payroll.colDate'), render: (r) => <span className="font-mono">{day(r.at)}</span> },
    { key: 'driver', header: t('payroll.colDriver'), render: () => <span className="text-ink">{name}</span> },
    { key: 'kind', header: t('payroll.colKind'), render: (r) => <span className="text-slate">{r.kind === 'early' ? t('payroll.early') : t('payroll.evening')}{r.place ? ` · ${r.place}` : ''}</span> },
    { key: 'from', header: t('payroll.colFrom'), render: (r) => <span className="font-mono">{time(r.started_at)}</span> },
    { key: 'to', header: t('payroll.colTo'), render: (r) => <span className="font-mono">{time(r.ended_at)}</span> },
    { key: 'min', header: t('payroll.colMinutes'), className: 'text-right', render: (r) => <span className="font-mono">{r.minutes ?? 0}</span> },
    {
      key: 'tariff',
      header: t('payroll.colTariffHour'),
      className: 'text-right',
      render: (r) => <span className="font-mono text-slate">{r.tariff_som != null ? money(r.tariff_som) : '—'}</span>,
    },
    { key: 'price', header: t('payroll.colPrice'), className: 'text-right', render: (r) => <span className="font-mono font-semibold text-ink">{money(r.amount_som)}</span> },
  ];

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate(`/payroll?${qs}`)}
        className="mb-3 text-sm font-medium text-slate hover:text-ink"
      >
        ← {t('common.back')}
      </button>
      <PageHeader title={name} subtitle={data?.vehicle ?? undefined} />

      {/* His Excel sits right in front of the period it is for (owner, 29.10.2026). */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button type="button" className="btn-ghost" disabled={excelM.isPending} onClick={() => excelM.mutate()}>
          {t('payroll.downloadExcel')}
        </button>
        <PeriodPicker period={period} onChange={setPeriod} />
      </div>
      {excelM.isError ? <ErrorNote error={excelM.error} /> : null}

      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((x) => (
          <button
            key={x.key}
            type="button"
            aria-pressed={tab === x.key}
            onClick={() => setTab(x.key)}
            className={`rounded-lg border px-4 py-2.5 text-left transition-colors ${
              tab === x.key ? 'border-[#14181f] bg-[#14181f] text-white' : 'border-[#d6dae0] bg-white text-ink hover:bg-[#f5f6f8]'
            }`}
          >
            <div className="text-sm font-semibold">{x.label}</div>
            <div className={`font-mono text-sm ${tab === x.key ? 'text-white' : 'text-slate'}`}>
              {money(total(x.rows))} · {x.rows.length}
            </div>
          </button>
        ))}
      </div>

      <Card>
        {isLoading ? (
          <Spinner />
        ) : current.rows.length === 0 ? (
          <EmptyState title={t('payroll.noData')} />
        ) : (
          <DataTable columns={tab === 'overtime' ? hours : trips} rows={current.rows} keyOf={(r) => r.id} />
        )}
      </Card>
    </div>
  );
}
