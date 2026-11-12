import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ManageableRole, UserPage, UserPublic } from '@bigant/shared';
import { api } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { Card, DataTable, EmptyState, ErrorNote, Spinner, type Column } from './ui';
import { SearchInput } from './SearchInput';
import { Pager } from './Pager';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { UserFormModal } from './forms/UserFormModal';
import { ConfirmDialog } from './ConfirmDialog';
import { ItemActions } from './ItemActions';
import { formatDateTime } from '../lib/format';
import { useAuth } from '../auth/AuthContext';

function StatusPill({ status }: { status: UserPublic['status'] }) {
  const { t } = useTranslation();
  const active = status === 'active';
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        active ? 'bg-[#e6f6ec] text-[#15803d]' : 'bg-[#f0f1f3] text-[#8a93a0]'
      }`}
    >
      {active ? t('team.active') : t('team.inactive')}
    </span>
  );
}

/** Rows per page. */
const PAGE = 25;

/**
 * Account table for one manageable role. Body only — the page title and the
 * role switcher belong to the parent (see StaffPage), so this renders the
 * search row, table and modals.
 */
export function UsersManagement({
  role,
  onOpen,
}: {
  role: ManageableRole;
  onOpen?: (user: UserPublic) => void;
}) {
  const { t } = useTranslation();
  // Nobody deletes an account: it is switched off and keeps its history. A
  // dispatcher cannot switch an admin off or on (owner, 29.10.2026).
  const isAdmin = useAuth().user?.role === 'admin';
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<UserPublic | null>(null);
  const [deactivating, setDeactivating] = useState<UserPublic | null>(null);
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search, 250);
  // Working staff by default; the button shows the ones let go (owner, 29.10.2026).
  const [dismissed, setDismissed] = useState(false);

  const [page, setPage] = useState(0);
  const { data, isLoading } = useQuery({
    queryKey: ['users', 'page', role, q, page, dismissed],
    queryFn: () =>
      api.get<UserPage>(
        `/users/page?role=${role}&status=${dismissed ? 'inactive' : 'active'}&skip=${page * PAGE}&take=${PAGE}` +
          (q ? `&search=${encodeURIComponent(q)}` : ''),
      ),
    refetchInterval: 15_000,
    placeholderData: (prev) => prev,
  });
  const rows = data?.items ?? [];
  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE));

  // Prefix must match positionally: ['users', role] never matched the paginated
  // key ['users', 'page', role, …], so the table only refreshed on the 15s poll.
  // ['users'] covers the table and the role dropdowns elsewhere.
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['users'] });

  const deactivateM = useMutation({
    mutationFn: (id: string) => api.del(`/users/${id}`),
    onSuccess: () => {
      invalidate();
      setDeactivating(null);
    },
  });

  const activateM = useMutation({
    mutationFn: (id: string) => api.patch(`/users/${id}`, { status: 'active' }),
    onSuccess: invalidate,
  });

  const columns: Column<UserPublic>[] = [
    {
      key: 'name',
      header: t('team.colName'),
      render: (u) =>
        onOpen ? (
          <button
            type="button"
            onClick={() => onOpen(u)}
            className="font-medium text-brand hover:underline"
          >
            {u.name}
          </button>
        ) : (
          <span className="font-medium text-ink">{u.name}</span>
        ),
    },
    { key: 'phone', header: t('team.colPhone'), render: (u) => <span className="font-mono text-slate">{u.phone_number}</span> },
    { key: 'status', header: t('team.colStatus'), render: (u) => <StatusPill status={u.status} /> },
    {
      key: 'created',
      header: t('team.colCreated'),
      render: (u) => <span className="text-slate">{formatDateTime(u.created_at)}</span>,
    },
    // Editing and deactivating sit on every row, whether or not the name
    // also opens a page: the office should not have to go in to find them.
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (u: UserPublic) => (
        // The row itself opens the page; the buttons on it must not.
        <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          {u.status === 'active' && (isAdmin || u.role !== 'admin') && (
            <button
              type="button"
              className="text-sm font-medium text-slate hover:underline"
              onClick={() => setDeactivating(u)}
            >
              {t('team.deactivate')}
            </button>
          )}
          {u.status !== 'active' && (isAdmin || u.role !== 'admin') && (
            <button
              type="button"
              className="text-sm font-medium text-[#15803d] hover:underline disabled:opacity-50"
              disabled={activateM.isPending}
              onClick={() => activateM.mutate(u.id)}
            >
              {t('team.activate')}
            </button>
          )}
          {isAdmin && (
            <ItemActions size="sm" editLabel={t('team.edit')} onEdit={() => setEditing(u)} />
          )}
        </div>
      ),
    },
  ];

  const newLabel = role === 'admin' ? t('team.newAdmin') : role === 'manager' ? t('team.newManager') : t('team.newSeller');
  const emptyTitle = role === 'admin' ? t('team.noAdmins') : role === 'manager' ? t('team.noManagers') : t('team.noSellers');
  const emptyHint = role === 'admin' ? t('team.noAdminsHint') : role === 'manager' ? t('team.noManagersHint') : t('team.noSellersHint');

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <DismissedToggle
          on={dismissed}
          onChange={(v) => {
            setDismissed(v);
            setPage(0);
          }}
        />
        <div className="min-w-[200px] flex-1">
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(0);
            }}
            placeholder={t('team.search')}
          />
        </div>
        {isAdmin && (
          <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
            {newLabel}
          </button>
        )}
      </div>

      {/* Re-activating used to fail in silence — the row simply stayed
          inactive with no reason given. */}
      {activateM.isError ? <ErrorNote error={activateM.error} /> : null}

      <Card>
        {isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState
            title={q ? t('common.noResults') : emptyTitle}
            hint={q ? t('common.noResultsHint') : emptyHint}
          />
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={rows}
              keyOf={(u) => u.id}
              onRowClick={onOpen ? (u) => onOpen(u) : undefined}
            />
            <Pager page={page} count={pageCount} onPage={setPage} size="lg" />
          </>
        )}
      </Card>

      <UserFormModal open={createOpen} onClose={() => setCreateOpen(false)} role={role} />
      <UserFormModal
        open={!!editing}
        editing={editing}
        onClose={() => setEditing(null)}
        role={role}
      />
      <ConfirmDialog
        open={!!deactivating}
        title={t('team.dismissAsk', { name: deactivating?.name ?? '' })}
        pending={deactivateM.isPending}
        error={deactivateM.isError ? deactivateM.error : undefined}
        onClose={() => setDeactivating(null)}
        onConfirm={() => deactivating && deactivateM.mutate(deactivating.id)}
      />
    </div>
  );
}

/** "Ishdan bo'shatilganlar": switches the list between working staff and the ones let go. */
export function DismissedToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
        on ? 'border-[#14181f] bg-[#14181f] text-white' : 'border-[#d6dae0] bg-white text-[#5b6470] hover:bg-[#f5f6f8]'
      }`}
    >
      {t('team.dismissedList')}
    </button>
  );
}
