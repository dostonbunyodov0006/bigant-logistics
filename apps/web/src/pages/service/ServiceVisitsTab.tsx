import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  SERVICE_VISIT_ORIGINS,
  SERVICE_VISIT_STATUSES,
  type DriverPublic,
  type ServiceCenter,
  type ServiceReason,
  type ServiceVisit,
} from '@bigant/shared';
import { api } from '../../lib/api';
import { Card, DataTable, EmptyState, Spinner, type Column } from '../../components/ui';
import { OutcomeChip, dayTime, downloadCsv } from '../fuel/fuelShared';
import { ReceiptCell, StatusChip, VisitPayerCell, km, sum, useServiceLabels } from './serviceShared';
import { ServiceVisitDetailModal } from './ServiceVisitDetailModal';
import { AssignVisitModal } from './AssignVisitModal';
import type { Period } from '../FuelPage';

/** Every visit in the period — booked, happening, done — filterable, exportable; a row opens the detail. */
export function ServiceVisitsTab({ period, onPeriod }: { period: Period; onPeriod: (p: Period) => void }) {
  const { t } = useTranslation();
  const L = useServiceLabels();
  const [driver, setDriver] = useState('');
  const [center, setCenter] = useState('');
  const [reason, setReason] = useState('');
  const [origin, setOrigin] = useState('');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<ServiceVisit | null>(null);
  const [assigning, setAssigning] = useState(false);

  const driversQ = useQuery({ queryKey: ['drivers'], queryFn: () => api.get<DriverPublic[]>('/drivers') });
  const centersQ = useQuery({ queryKey: ['service', 'centers', 'all'], queryFn: () => api.get<ServiceCenter[]>('/service/centers/all') });
  const reasonsQ = useQuery({ queryKey: ['service', 'reasons', 'all'], queryFn: () => api.get<ServiceReason[]>('/service/reasons/all') });

  const params = new URLSearchParams();
  if (driver) params.set('driver_id', driver);
  if (center) params.set('center_id', center);
  if (reason) params.set('reason_id', reason);
  if (origin) params.set('origin', origin);
  if (status) params.set('status', status);
  if (period.from) params.set('from', period.from);
  if (period.to) params.set('to', period.to);
  const qs = params.toString();
  const q = useQuery({ queryKey: ['service', 'visits', qs], queryFn: () => api.get<ServiceVisit[]>(`/service/visits${qs ? `?${qs}` : ''}`) });
  const rows = q.data ?? [];

  // The modal shows the row it was opened with; when the list refetches after
  // an action, follow it so the buttons reflect the new state.
  const live = open ? (rows.find((v) => v.id === open.id) ?? open) : null;

  const columns = useMemo<Column<ServiceVisit>[]>(
    () => [
      {
        key: 'date',
        header: t('service.visits.colDate'),
        render: (v) => <span className="font-mono text-xs">{dayTime(v.completed_at ?? v.started_at ?? v.scheduled_at ?? v.created_at)}</span>,
      },
      {
        key: 'driver',
        header: t('service.visits.colDriver'),
        render: (v) => (
          <div>
            <div className="font-medium">{v.driver_name ?? '—'}</div>
            <div className="text-xs text-slate">{[v.vehicle_model, v.vehicle_plate].filter(Boolean).join(' · ')}</div>
          </div>
        ),
      },
      {
        key: 'works',
        header: t('service.visits.colWorks'),
        render: (v) => (
          <div className="text-sm">
            {L.works(v)}
            {v.driver_comment && <div className="truncate text-xs text-slate" title={v.driver_comment}>„{v.driver_comment}”</div>}
          </div>
        ),
      },
      {
        key: 'center',
        header: t('service.visits.colCenter'),
        render: (v) => (
          <div className="flex flex-col items-start gap-1">
            <span>{v.status === 'completed' || v.status === 'in_progress' ? L.place(v) : (v.selected_center?.name ?? '—')}</span>
            {v.outcome && <OutcomeChip outcome={v.outcome} />}
          </div>
        ),
      },
      { key: 'km', header: t('service.visits.colKm'), className: 'text-right', render: (v) => <span className="font-mono">{v.odometer_km != null ? km(v.odometer_km) : '—'}</span> },
      { key: 'total', header: t('service.visits.colTotal'), className: 'text-right', render: (v) => <span className="font-mono font-semibold">{sum(v.total_sum)}</span> },
      { key: 'origin', header: t('service.visits.colOrigin'), render: (v) => <span className="text-xs">{L.origin(v)}</span> },
      { key: 'status', header: t('service.visits.colStatus'), render: (v) => <StatusChip status={v.status} /> },
      { key: 'receipt', header: t('service.visits.colReceipt'), render: (v) => <ReceiptCell visit={v} /> },
      { key: 'payer', header: t('fuel.colPayer'), render: (v) => <VisitPayerCell visit={v} /> },
    ],
    [t, L],
  );

  const exportCsv = () =>
    downloadCsv(
      `service-${period.from || 'all'}-${period.to || 'all'}.csv`,
      ['date', 'driver', 'vehicle', 'works', 'center', 'outcome', 'odometer_km', 'total_sum', 'origin', 'order', 'status', 'receipt', 'comment', 'settlement', 'settled_at'],
      rows.map((v) => [
        v.completed_at ?? v.scheduled_at,
        v.driver_name,
        v.vehicle_plate,
        L.works(v),
        L.place(v),
        v.outcome,
        v.odometer_km,
        v.total_sum,
        v.origin,
        v.client_name,
        v.status,
        v.receipt_photo_url ? 'yes' : v.no_receipt ? 'none' : '',
        v.driver_comment,
        v.settlement,
        v.settled_at,
      ]),
    );

  const sel = (id: string, label: string, value: string, set: (v: string) => void, options: { value: string; label: string }[]) => (
    <div>
      <label className="field-label" htmlFor={id}>{label}</label>
      <select id={id} className="input" value={value} onChange={(e) => set(e.target.value)}>
        <option value="">{t('fuel.all')}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );

  return (
    <>
      <div className="mb-4 flex justify-end gap-2">
        <button type="button" className="btn-primary" onClick={() => setAssigning(true)}>{t('service.due.send')}</button>
        <button type="button" className="btn-ghost" disabled={rows.length === 0} onClick={exportCsv}>{t('fuel.downloadCsv')}</button>
      </div>

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
          {sel('sv-driver', t('fuel.filterDriver'), driver, setDriver, (driversQ.data ?? []).map((d) => ({ value: d.id, label: d.name })))}
          {sel('sv-center', t('service.visits.filterCenter'), center, setCenter, (centersQ.data ?? []).map((c) => ({ value: c.id, label: c.name })))}
          {sel('sv-reason', t('service.visits.filterWork'), reason, setReason, (reasonsQ.data ?? []).map((r) => ({ value: r.id, label: r.name })))}
          {sel('sv-origin', t('service.visits.filterOrigin'), origin, setOrigin, SERVICE_VISIT_ORIGINS.map((o) => ({ value: o, label: t(`service.origin.${o}`) })))}
          {sel('sv-status', t('service.visits.filterStatus'), status, setStatus, SERVICE_VISIT_STATUSES.map((s) => ({ value: s, label: t(`service.status.${s}`) })))}
          <div>
            <label className="field-label" htmlFor="sv-from">{t('fuel.from')}</label>
            <input id="sv-from" type="date" className="input" value={period.from} max={period.to} onChange={(e) => onPeriod({ ...period, from: e.target.value })} />
          </div>
          <div>
            <label className="field-label" htmlFor="sv-to">{t('fuel.to')}</label>
            <input id="sv-to" type="date" className="input" value={period.to} min={period.from} onChange={(e) => onPeriod({ ...period, to: e.target.value })} />
          </div>
        </div>
      </Card>

      <Card>
        {q.isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState title={t('service.visits.empty')} hint={t('service.visits.emptyHint')} />
        ) : (
          <DataTable columns={columns} rows={rows} keyOf={(v) => v.id} onRowClick={setOpen} />
        )}
      </Card>

      <ServiceVisitDetailModal visit={live} onClose={() => setOpen(null)} />
      <AssignVisitModal item={null} open={assigning} onClose={() => setAssigning(false)} />
    </>
  );
}
