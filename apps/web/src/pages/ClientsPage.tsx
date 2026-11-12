import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ClientPage, ClientPublic } from '@bigant/shared';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { Card, DataTable, EmptyState, PageHeader, Spinner, type Column } from '../components/ui';
import { NoLocationBadge } from '../components/NoLocationBadge';
import { SearchInput } from '../components/SearchInput';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { ClientFormModal } from '../components/forms/ClientFormModal';
import { ItemActions } from '../components/ItemActions';
import { Pager } from '../components/Pager';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { queryClient } from '../lib/queryClient';
import { useSellers } from '../lib/useSellers';

/** Rows per page. */
const PAGE = 25;

export function ClientsPage() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ClientPublic | null>(null);
  const [deleting, setDeleting] = useState<ClientPublic | null>(null);
  const deleteM = useMutation({
    mutationFn: (id: string) => api.del(`/clients/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['clients'] });
      setDeleting(null);
    },
  });
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search, 250);
  const [page, setPage] = useState(0);
  // Staff see every client and whose it is; a seller only ever gets their own.
  const isStaff = user?.role === 'admin' || user?.role === 'manager';
  const [sellerFilter, setSellerFilter] = useState('');
  const sellersQ = useSellers(isStaff);

  // Server-side paging: the list used to fetch every client in the database.
  const { data, isLoading } = useQuery({
    queryKey: ['clients', 'page', q, page, sellerFilter],
    queryFn: () =>
      api.get<ClientPage>(
        `/clients/page?skip=${page * PAGE}&take=${PAGE}${q ? `&search=${encodeURIComponent(q)}` : ''}${
          sellerFilter ? `&seller_id=${encodeURIComponent(sellerFilter)}` : ''
        }`,
      ),
    placeholderData: (prev) => prev,
  });
  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE));

  // The server lets a manager do this; see roles.guard.ts.
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';
  const canEdit = isAdmin || user?.role === 'seller';
  const canViewDetail = user?.role === 'admin' || user?.role === 'manager';

  const columns: Column<ClientPublic>[] = [
    {
      key: 'name',
      header: t('clients.colClient'),
      render: (c) => (
        <span className={`font-medium ${canViewDetail ? 'text-brand' : 'text-ink'}`}>{c.name}</span>
      ),
    },
    { key: 'phone', header: t('clients.colPhone'), render: (c) => <span className="font-mono text-slate">{c.phone_number}</span> },
    ...(isStaff
      ? [
          {
            key: 'seller',
            header: t('clients.colSeller'),
            render: (c: ClientPublic) =>
              c.seller_name ? (
                <span className="text-ink">{c.seller_name}</span>
              ) : (
                <span className="rounded bg-[#fef6e7] px-2 py-0.5 text-xs font-semibold text-[#a15c07]">{t('clients.sellerNone')}</span>
              ),
          },
        ]
      : []),
    {
      key: 'address',
      header: t('clients.colAddress'),
      render: (c) => (
        <span className="flex items-center gap-2 text-slate">
          <span>{c.address || '—'}</span>
          {c.lat == null && <NoLocationBadge />}
        </span>
      ),
    },
    // Edit on every row; delete too for staff, as on the client's own page.
    // The row opens that page, so the buttons keep their clicks to themselves.
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (c: ClientPublic) =>
        canEdit ? (
          <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
            <ItemActions
              size="sm"
              onEdit={() => setEditing(c)}
              onDelete={canViewDetail ? () => setDeleting(c) : undefined}
            />
          </div>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('clients.title')}
        actions={
          <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
            {t('clients.newClient')}
          </button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-[240px] flex-1">
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(0); // a new search restarts at the first page
            }}
            placeholder={t('clients.search')}
          />
        </div>
        {isStaff && (
          <select
            className="input w-auto"
            aria-label={t('clients.filterSeller')}
            value={sellerFilter}
            onChange={(e) => {
              setSellerFilter(e.target.value);
              setPage(0);
            }}
          >
            <option value="">{t('clients.filterAll')}</option>
            {(sellersQ.data ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
            <option value="none">{t('clients.filterNone')}</option>
          </select>
        )}
      </div>
      <Card>
        {isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState
            title={q ? t('common.noResults') : t('clients.noClients')}
            hint={q ? t('common.noResultsHint') : t('clients.noClientsHint')}
          />
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={rows}
              keyOf={(c) => c.id}
              onRowClick={canViewDetail ? (c) => navigate(`/clients/${c.id}`) : undefined}
            />
            <Pager page={page} count={pageCount} onPage={setPage} size="lg" />
          </>
        )}
      </Card>
      <ClientFormModal
        open={createOpen || !!editing}
        editing={editing}
        onClose={() => {
          setCreateOpen(false);
          setEditing(null);
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        title={t('clients.deleteTitle')}
        message={t('clients.deleteMessage', { name: deleting?.name ?? '' })}
        pending={deleteM.isPending}
        error={deleteM.isError ? deleteM.error : undefined}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteM.mutate(deleting.id)}
      />
    </div>
  );
}
