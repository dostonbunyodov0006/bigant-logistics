import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type {
  DriverPublic,
  ExpensePage, ExpensePublic,
  ExpenseSummary,
  ExpenseTypePublic,
  VehiclePublic,
} from '@bigant/shared';
import { MAX_PAGE_SIZE } from '@bigant/shared';
import { api } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { Card, DataTable, EmptyState, ErrorNote, PageHeader, Spinner, Tabs, type Column } from '../components/ui';
import { FuelPage } from './FuelPage';
import { Pager } from '../components/Pager';
import { ExpenseFormModal } from '../components/forms/ExpenseFormModal';
import { ExpenseTypesModal } from '../components/forms/ExpenseTypesModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ItemActions } from '../components/ItemActions';
import { tkMonthStart, tkYmd } from '../lib/tashkent';

const ymd = (d: Date) => tkYmd(d);
const money = (n: number) => n.toLocaleString();

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const PAGE = 25;

export function ExpensesPage() {
  // Yoqilg'i is a tab here, not a menu entry (owner, 02.11.2026): a fill-up is
  // an expense. The pick is in the address (?bolim=fuel).
  const [addr, setAddr] = useSearchParams();
  const bolim: 'all' | 'fuel' = addr.get('bolim') === 'fuel' ? 'fuel' : 'all';
  const embedded = bolim === 'fuel';
  const { t } = useTranslation();
  const now = new Date();
  const [type, setType] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [driver, setDriver] = useState('');
  const [from, setFrom] = useState(tkMonthStart());
  const [to, setTo] = useState(ymd(now));

  const [formOpen, setFormOpen] = useState(false);
  const [typesOpen, setTypesOpen] = useState(false);
  const [editing, setEditing] = useState<ExpensePublic | null>(null);
  const [deleting, setDeleting] = useState<ExpensePublic | null>(null);

  const typesQ = useQuery({
    queryKey: ['expenses', 'types'],
    queryFn: () => api.get<ExpenseTypePublic[]>('/expenses/types'),
  });
  const vehiclesQ = useQuery({
    queryKey: ['vehicles'],
      // Reference dropdown: bounded explicitly. A fleet/roster past this size
      // needs a searchable picker rather than a <select>.
    queryFn: () => api.get<VehiclePublic[]>(`/vehicles?take=${MAX_PAGE_SIZE}`),
  });
  const driversQ = useQuery({
    queryKey: ['drivers'],
    queryFn: () => api.get<DriverPublic[]>('/drivers'),
  });

  const params = new URLSearchParams();
  if (type) params.set('type_id', type);
  if (vehicle) params.set('vehicle_id', vehicle);
  if (driver) params.set('driver_id', driver);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();

  const [page, setPage] = useState(0);
  // Changing a filter must land on page 1, not on a page that no longer exists.
  useEffect(() => setPage(0), [qs]);

  const listQ = useQuery({
    queryKey: ['expenses', 'page', qs, page],
    queryFn: () => api.get<ExpensePage>(`/expenses/page?${qs}&skip=${page * PAGE}&take=${PAGE}`),
    placeholderData: (prev) => prev,
  });
  const summaryQ = useQuery({
    queryKey: ['expenses', 'summary', qs],
    queryFn: () => api.get<ExpenseSummary>(`/expenses/summary?${qs}`),
  });
  const expenses = listQ.data?.items ?? [];
  const matchCount = listQ.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(matchCount / PAGE));

  const deleteM = useMutation({
    mutationFn: (id: string) => api.del(`/expenses/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      setDeleting(null);
    },
  });

  const [exporting, setExporting] = useState(false);
  // A failed export used to end as an unhandled rejection: no file, no word.
  const [exportError, setExportError] = useState<unknown>(null);

  /** Walks every page so the file matches the filter, not the current page. */
  const fetchAllForExport = async (): Promise<ExpensePublic[]> => {
    const all: ExpensePublic[] = [];
    for (let skip = 0; skip < matchCount; skip += MAX_PAGE_SIZE) {
      const chunk = await api.get<ExpensePage>(
        `/expenses/page?${qs}&skip=${skip}&take=${MAX_PAGE_SIZE}`,
      );
      all.push(...chunk.items);
      if (chunk.items.length === 0) break;
    }
    return all;
  };

  const downloadCsv = async () => {
    if (matchCount === 0 || exporting) return;
    setExporting(true);
    setExportError(null);
    let rows: ExpensePublic[];
    try {
      rows = await fetchAllForExport();
    } catch (err) {
      setExportError(err);
      return;
    } finally {
      setExporting(false);
    }
    const header = [
      t('expenses.colDate'),
      t('expenses.colType'),
      t('expenses.colAmount'),
      t('expenses.colVehicle'),
      t('expenses.colDriver'),
      t('expenses.colNote'),
    ];
    const lines = [
      header.map(csvCell).join(','),
      ...rows.map((e) =>
        [e.spent_at, e.type_name ?? '', e.amount, e.vehicle_label ?? '', e.driver_name ?? '', e.note ?? '']
          .map(csvCell)
          .join(','),
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `expenses_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const columns: Column<ExpensePublic>[] = [
    { key: 'date', header: t('expenses.colDate'), render: (e) => <span className="font-mono text-slate">{e.spent_at}</span> },
    { key: 'type', header: t('expenses.colType'), render: (e) => <span className="font-medium text-ink">{e.type_name ?? '—'}</span> },
    { key: 'amount', header: t('expenses.colAmount'), className: 'text-right', render: (e) => <span className="font-mono text-ink">{money(e.amount)}</span> },
    { key: 'vehicle', header: t('expenses.colVehicle'), render: (e) => <span className="text-slate">{e.vehicle_label ?? '—'}</span> },
    { key: 'driver', header: t('expenses.colDriver'), render: (e) => <span className="text-slate">{e.driver_name ?? '—'}</span> },
    { key: 'note', header: t('expenses.colNote'), render: (e) => <span className="text-slate">{e.note ?? '—'}</span> },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (e) => (
        <div className="flex justify-end gap-2">
          {/* Fuel and service rows follow their fill or visit and are corrected there. */}
          {!e.source && (
            <ItemActions
              size="sm"
              onEdit={() => {
                setEditing(e);
                setFormOpen(true);
              }}
              onDelete={() => setDeleting(e)}
            />
          )}
        </div>
      ),
    },
  ];

  const s = summaryQ.data?.summary;

  return (
    <div>
      {!embedded && (
        <PageHeader
          title={t('expenses.title')}
          actions={
            <div className="flex gap-2">
              <button type="button" className="btn-ghost" onClick={() => setTypesOpen(true)}>
                {t('expenses.manageTypes')}
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={matchCount === 0 || exporting}
                onClick={() => void downloadCsv()}
              >
                {t('expenses.downloadCsv')}
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                {t('expenses.newExpense')}
              </button>
            </div>
          }
        />
      )}
      <Tabs<'all' | 'fuel'>
        tabs={[
          { value: 'all', label: t('expenses.tabAll') },
          { value: 'fuel', label: t('nav.fuel') },
        ]}
        active={bolim}
        onChange={(k) => setAddr(k === 'all' ? {} : { bolim: k }, { replace: true })}
      />
      {bolim === 'fuel' ? (
        <FuelPage embedded />
      ) : (
        <>

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="field-label" htmlFor="ex-type">{t('expenses.filterType')}</label>
            <select id="ex-type" className="input" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">{t('expenses.allTypes')}</option>
              {typesQ.data?.map((tp) => (
                <option key={tp.id} value={tp.id}>{tp.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="ex-vehicle">{t('expenses.filterVehicle')}</label>
            <select id="ex-vehicle" className="input" value={vehicle} onChange={(e) => setVehicle(e.target.value)}>
              <option value="">{t('expenses.allVehicles')}</option>
              {vehiclesQ.data?.map((v) => (
                <option key={v.id} value={v.id}>{v.plate_number}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="ex-driver">{t('expenses.filterDriver')}</label>
            <select id="ex-driver" className="input" value={driver} onChange={(e) => setDriver(e.target.value)}>
              <option value="">{t('expenses.allDrivers')}</option>
              {driversQ.data?.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="ex-from">{t('expenses.from')}</label>
            <input id="ex-from" type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="ex-to">{t('expenses.to')}</label>
            <input id="ex-to" type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="p-5">
          <div className="font-mono text-2xl font-semibold text-ink">{money(s?.total ?? 0)}</div>
          <div className="mt-1 text-sm text-slate">{t('expenses.totalSpent')}</div>
        </Card>
        <Card className="p-5">
          <div className="font-mono text-2xl font-semibold text-brandDark">{s?.count ?? 0}</div>
          <div className="mt-1 text-sm text-slate">{t('expenses.entries')}</div>
        </Card>
        <Card className="p-5 lg:col-span-2">
          <div className="mb-2 text-sm font-medium text-slate">{t('expenses.byType')}</div>
          {(summaryQ.data?.by_type ?? []).length === 0 ? (
            <div className="text-sm text-slate-light">—</div>
          ) : (
            <div className="space-y-1">
              {summaryQ.data?.by_type.slice(0, 4).map((r) => (
                <div key={r.type_id} className="flex justify-between text-sm">
                  <span className="text-slate">{r.type_name ?? '—'}</span>
                  <span className="font-mono text-ink">{money(r.total)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {exportError ? <ErrorNote error={exportError} /> : null}

      <Card>
        {listQ.isLoading ? (
          <Spinner />
        ) : expenses.length === 0 ? (
          <EmptyState title={t('expenses.noData')} hint={t('expenses.noDataHint')} />
        ) : (
          <>
            <DataTable columns={columns} rows={expenses} keyOf={(e) => e.id} />
            <Pager page={page} count={pageCount} onPage={setPage} size="lg" />
          </>
        )}
      </Card>

      <ExpenseFormModal open={formOpen} editing={editing} onClose={() => setFormOpen(false)} />
      <ExpenseTypesModal open={typesOpen} onClose={() => setTypesOpen(false)} />
      <ConfirmDialog
        open={!!deleting}
        title={t('expenses.deleteTitle')}
        message={t('expenses.deleteMessage', { amount: money(deleting?.amount ?? 0) })}
        pending={deleteM.isPending}
        error={deleteM.isError ? deleteM.error : undefined}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteM.mutate(deleting.id)}
      />
        </>
      )}
    </div>
  );
}
