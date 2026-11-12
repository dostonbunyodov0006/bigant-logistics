import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { LEAVE_STATUSES, type DriverPublic, type LeaveRequestPublic, type LeaveStatus } from '@bigant/shared';
import { api } from '../lib/api';
import { Card, DataTable, EmptyState, PageHeader, Spinner, type Column } from '../components/ui';
import { LeaveReviewModal } from '../components/forms/LeaveReviewModal';
import { LeaveGrantModal } from '../components/forms/LeaveGrantModal';
import { formatDateTime } from '../lib/format';

const STATUS_STYLES: Record<LeaveStatus, string> = {
  pending: 'bg-[#fef6e6] text-[#b45309]',
  approved: 'bg-[#e6f6ec] text-[#15803d]',
  rejected: 'bg-[#fdeaea] text-[#dc2626]',
};

export function LeavePage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<'' | LeaveStatus>('');
  const [driver, setDriver] = useState('');
  const [reviewing, setReviewing] = useState<LeaveRequestPublic | null>(null);
  const [granting, setGranting] = useState(false);

  const driversQ = useQuery({
    queryKey: ['drivers'],
    queryFn: () => api.get<DriverPublic[]>('/drivers'),
  });

  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (driver) params.set('driver_id', driver);
  const qs = params.toString();

  const leaveQ = useQuery({
    queryKey: ['leave', qs],
    queryFn: () => api.get<LeaveRequestPublic[]>(`/leave${qs ? `?${qs}` : ''}`),
  });
  const rows = leaveQ.data ?? [];

  const columns: Column<LeaveRequestPublic>[] = [
    { key: 'driver', header: t('leave.colDriver'), render: (r) => <span className="font-medium text-ink">{r.driver_name ?? '—'}</span> },
    { key: 'type', header: t('leave.colType'), render: (r) => <span className="text-slate">{t(`leaveType.${r.type}`)}</span> },
    {
      key: 'period',
      header: t('leave.colPeriod'),
      render: (r) => <span className="font-mono text-slate">{r.start_date} → {r.end_date}</span>,
    },
    { key: 'reason', header: t('leave.colReason'), render: (r) => <span className="text-slate">{r.reason ?? '—'}</span> },
    {
      key: 'status',
      header: t('leave.colStatus'),
      render: (r) => (
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[r.status]}`}>
          {t(`leaveStatus.${r.status}`)}
        </span>
      ),
    },
    {
      key: 'reviewedBy',
      header: t('leave.colReviewedBy'),
      render: (r) =>
        r.status === 'pending' ? (
          <button
            type="button"
            className="text-sm font-medium text-brand hover:underline"
            onClick={() => setReviewing(r)}
          >
            {t('leave.review')}
          </button>
        ) : (
          <span className="text-sm text-slate" title={r.review_note ?? undefined}>
            {r.reviewed_by_name ?? '—'}
            {r.reviewed_at ? <span className="ml-1 text-slate-light">· {formatDateTime(r.reviewed_at)}</span> : null}
          </span>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('leave.title')}
        subtitle={t('leave.subtitle')}
        actions={
          <button type="button" className="btn-primary" onClick={() => setGranting(true)}>
            {t('leave.grant')}
          </button>
        }
      />

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="field-label" htmlFor="lv-status">{t('leave.filterStatus')}</label>
            <select id="lv-status" className="input" value={status} onChange={(e) => setStatus(e.target.value as '' | LeaveStatus)}>
              <option value="">{t('leave.allStatuses')}</option>
              {LEAVE_STATUSES.map((s) => (
                <option key={s} value={s}>{t(`leaveStatus.${s}`)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="lv-driver">{t('leave.filterDriver')}</label>
            <select id="lv-driver" className="input" value={driver} onChange={(e) => setDriver(e.target.value)}>
              <option value="">{t('leave.allDrivers')}</option>
              {driversQ.data?.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      <Card>
        {leaveQ.isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState title={t('leave.noData')} hint={t('leave.noDataHint')} />
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            keyOf={(r) => r.id}
            // Anywhere on a pending row opens the review; the button is just a hint.
            onRowClick={(r) => {
              if (r.status === 'pending') setReviewing(r);
            }}
          />
        )}
      </Card>

      <LeaveReviewModal request={reviewing} onClose={() => setReviewing(null)} />
      <LeaveGrantModal open={granting} drivers={driversQ.data ?? []} onClose={() => setGranting(false)} />
    </div>
  );
}
