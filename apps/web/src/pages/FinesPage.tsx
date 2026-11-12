import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { DriverPublic, FinePage, FinePublic } from '@bigant/shared';
import { api } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { Card, DataTable, EmptyState, PageHeader, Spinner, type Column } from '../components/ui';
import { FineFormModal } from '../components/forms/FineFormModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ItemActions } from '../components/ItemActions';
import { formatDateTime } from '../lib/format';
import { Pager } from '../components/Pager';
import { tkMonthStart, tkYmd } from '../lib/tashkent';

const ymd = (d: Date) => tkYmd(d);
const money = (n: number) => n.toLocaleString();

const PAGE = 25;

/** `embedded`: shown as a tab of Ish haqi, which carries the heading. */
export function FinesPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useTranslation();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FinePublic | null>(null);
  const [deleting, setDeleting] = useState<FinePublic | null>(null);

  const now = new Date();
  const [driver, setDriver] = useState('');
  const [from, setFrom] = useState(tkMonthStart());
  const [to, setTo] = useState(ymd(now));

  const driversQ = useQuery({
    queryKey: ['drivers'],
    queryFn: () => api.get<DriverPublic[]>('/drivers'),
  });

  const params = new URLSearchParams();
  if (driver) params.set('driver_id', driver);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();

  const [page, setPage] = useState(0);
  // Changing a filter must land on page 1 — otherwise you can sit on page 4 of a
  // result set that now has one page and see an empty table.
  useEffect(() => setPage(0), [qs]);

  const finesQ = useQuery({
    queryKey: ['fines', 'page', qs, page],
    queryFn: () => api.get<FinePage>(`/fines/page?${qs}&skip=${page * PAGE}&take=${PAGE}`),
    placeholderData: (prev) => prev,
  });
  const fines = finesQ.data?.items ?? [];
  const matchCount = finesQ.data?.total ?? 0;
  // Summed by the server across every match, not just this page.
  const total = finesQ.data?.total_amount ?? 0;
  const pageCount = Math.max(1, Math.ceil(matchCount / PAGE));

  const deleteM = useMutation({
    mutationFn: (id: string) => api.del(`/fines/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['fines'] });
      setDeleting(null);
    },
  });

  const columns: Column<FinePublic>[] = [
    { key: 'date', header: t('fines.colDate'), render: (f) => <span className="text-slate">{formatDateTime(f.created_at)}</span> },
    { key: 'driver', header: t('fines.colDriver'), render: (f) => <span className="font-medium text-ink">{f.driver_name ?? '—'}</span> },
    {
      key: 'order',
      header: t('fines.colOrder'),
      render: (f) => <span className="text-slate">{f.client_name ?? '—'}</span>,
    },
    { key: 'reason', header: t('fines.colReason'), render: (f) => <span className="text-slate">{f.reason}</span> },
    { key: 'issuedBy', header: t('fines.colIssuedBy'), render: (f) => <span className="text-slate">{f.issued_by_name ?? '—'}</span> },
    {
      key: 'amount',
      header: t('fines.colAmount'),
      className: 'text-right',
      render: (f) => <span className="font-mono text-ink">{money(f.amount)}</span>,
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (f) => (
        <div className="flex justify-end gap-2">
          <ItemActions
            size="sm"
            onEdit={() => {
              setEditing(f);
              setFormOpen(true);
            }}
            onDelete={() => setDeleting(f)}
          />
        </div>
      ),
    },
  ];

  return (
    <div>
      {!embedded && (
        <PageHeader
          title={t('fines.title')}
          actions={
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              {t('fines.newFine')}
            </button>
          }
        />
      )}

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="field-label" htmlFor="f-driver">{t('fines.filterDriver')}</label>
            <select id="f-driver" className="input" value={driver} onChange={(e) => setDriver(e.target.value)}>
              <option value="">{t('fines.allDrivers')}</option>
              {driversQ.data?.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="f-from">{t('fines.from')}</label>
            <input id="f-from" type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="f-to">{t('fines.to')}</label>
            <input id="f-to" type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      </Card>

      <Card>
        {finesQ.isLoading ? (
          <Spinner />
        ) : fines.length === 0 ? (
          <EmptyState title={t('fines.noFines')} hint={t('fines.noFinesHint')} />
        ) : (
          <>
            <DataTable columns={columns} rows={fines} keyOf={(f) => f.id} />
            <Pager page={page} count={pageCount} onPage={setPage} size="lg" />
            <div className="flex items-center justify-between border-t border-mist px-4 py-3 text-sm">
              <span className="font-medium text-slate">{t('fines.entries', { n: matchCount })}</span>
              <span className="font-mono font-semibold text-ink">
                {t('fines.total')}: {money(total)} {t('fines.som')}
              </span>
            </div>
          </>
        )}
      </Card>

      <FineFormModal open={formOpen} editing={editing} onClose={() => setFormOpen(false)} />
      <ConfirmDialog
        open={!!deleting}
        title={t('fines.deleteTitle')}
        message={t('fines.deleteMessage', { name: deleting?.driver_name ?? '', amount: money(deleting?.amount ?? 0) })}
        pending={deleteM.isPending}
        error={deleteM.isError ? deleteM.error : undefined}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteM.mutate(deleting.id)}
      />
    </div>
  );
}
