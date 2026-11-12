import { lazy, Suspense, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { DriverPublic } from '@bigant/shared';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { DriverStatusBadge } from '../components/StatusBadge';
import { Card, DataTable, EmptyState, ErrorNote, PageHeader, Spinner, Tabs, type Column } from '../components/ui';
import { DriverAnalyticsPage } from './DriverAnalyticsPage';
import { DriverTrackPage } from './DriverTrackPage';

type Bolim = 'list' | 'analytics' | 'track';
import { SearchInput } from '../components/SearchInput';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { DriverAccountModal } from '../components/forms/DriverAccountModal';
import { DriverFormModal } from '../components/forms/DriverFormModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ItemActions } from '../components/ItemActions';
import { DismissedToggle } from '../components/UsersManagement';
import { queryClient } from '../lib/queryClient';

const DriversMap = lazy(() =>
  import('../components/DriversMap').then((m) => ({ default: m.DriversMap })),
);

/** `embedded`: shown as the Haydovchilar tab of Foydalanuvchilar, without its own title. */
export function DriversPage({ embedded = false }: { embedded?: boolean } = {}) {
  // Haydovchi tahlili and Yo'l tarixi are tabs here, not menu entries (owner,
  // 02.11.2026). The pick is in the address (?bolim=track) so a refresh or an
  // old link keeps it. Embedded (Xodimlar) there are no tabs: the list alone.
  const [addr, setAddr] = useSearchParams();
  const bolim: Bolim = embedded ? 'list' : addr.get('bolim') === 'analytics' ? 'analytics' : addr.get('bolim') === 'track' ? 'track' : 'list';
  const { user } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [view, setView] = useState<'list' | 'map'>('list');
  // Once opened the map stays alive behind the list: Google bills each map it
  // creates, and switching back should not be another one.
  const [mapSeen, setMapSeen] = useState(false);
  useEffect(() => {
    if (view === 'map') setMapSeen(true);
  }, [view]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<DriverPublic | null>(null);
  const [deleting, setDeleting] = useState<DriverPublic | null>(null);
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search, 250);
  // Working drivers by default; the button shows the ones let go.
  const [dismissed, setDismissed] = useState(false);

  const { data = [], isLoading } = useQuery({
    queryKey: ['drivers', q, dismissed],
    queryFn: () =>
      api.get<DriverPublic[]>(
        `/drivers?status=${dismissed ? 'inactive' : 'active'}${q ? `&search=${encodeURIComponent(q)}` : ''}`,
      ),
    // SSE keeps this live; the slow interval is only a reconnect/token-refresh safety net.
    refetchInterval: 60_000,
  });

  // The server lets a manager do this; see roles.guard.ts.
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';
  const canViewDetail = user?.role === 'admin' || user?.role === 'manager';

  const deleteM = useMutation({
    mutationFn: (id: string) => api.del(`/drivers/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['drivers'] });
      setDeleting(null);
    },
  });
  const rehireM = useMutation({
    mutationFn: (id: string) => api.post(`/drivers/${id}/rehire`, {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['drivers'] }),
  });

  const columns: Column<DriverPublic>[] = [
    {
      key: 'name',
      header: t('drivers.colDriver'),
      render: (d) => (
        <div className="flex items-center gap-2">
          <span className={`font-medium ${canViewDetail ? 'text-brand' : 'text-ink'}`}>{d.name}</span>
          {d.docs_expiry_alert && (
            <span
              title={
                d.docs_expiry_alert === 'expired'
                  ? t('drivers.docExpired')
                  : t('drivers.docExpiring')
              }
              className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${
                d.docs_expiry_alert === 'expired'
                  ? 'bg-[#fdeaea] text-[#dc2626]'
                  : 'bg-[#fef6e7] text-[#a15c07]'
              }`}
            >
              !
            </span>
          )}
        </div>
      ),
    },
    { key: 'phone', header: t('drivers.colPhone'), render: (d) => <span className="font-mono text-slate">{d.phone_number}</span> },
    { key: 'status', header: t('drivers.colStatus'), render: (d) => <DriverStatusBadge status={d.current_status} /> },
    {
      key: 'vehicle',
      header: t('drivers.colVehicle'),
      render: (d) => <span className="text-slate">{d.vehicle_plate ?? d.vehicle_info ?? '—'}</span>,
    },
    {
      key: 'model',
      header: t('drivers.colModel'),
      render: (d) => <span className="text-slate">{d.vehicle_model ?? '—'}</span>,
    },
    // Edit and delete on the row, as on the driver's own page; the row itself
    // opens that page, so the buttons keep their clicks to themselves.
    ...(isAdmin
      ? [
          {
            key: 'actions',
            header: '',
            className: 'text-right',
            render: (d: DriverPublic) => (
              <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                {dismissed ? (
                  <button
                    type="button"
                    className="text-sm font-medium text-[#15803d] hover:underline disabled:opacity-50"
                    disabled={rehireM.isPending}
                    onClick={() => rehireM.mutate(d.id)}
                  >
                    {t('team.activate')}
                  </button>
                ) : (
                  <ItemActions
                    size="sm"
                    onEdit={() => setEditing(d)}
                    onDelete={() => setDeleting(d)}
                    deleteIcon="block"
                    deleteLabel={t('drivers.deleteTitle')}
                  />
                )}
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <div>
      {embedded ? (
        // Inside Foydalanuvchilar the tab already says what this is.
        <div className="mb-4 flex justify-end">
            <div className="flex items-center gap-3">
              <div className="flex overflow-hidden rounded-lg border border-[#d6dae0]">
                <button
                  type="button"
                  className={`px-3 py-1.5 text-sm font-semibold transition-colors ${
                    view === 'list'
                      ? 'bg-[#14181f] text-white'
                      : 'bg-white text-[#5b6470] hover:bg-[#f5f6f8]'
                  }`}
                  onClick={() => setView('list')}
                >
                  {t('drivers.viewList')}
                </button>
                <button
                  type="button"
                  className={`px-3 py-1.5 text-sm font-semibold transition-colors ${
                    view === 'map'
                      ? 'bg-[#14181f] text-white'
                      : 'bg-white text-[#5b6470] hover:bg-[#f5f6f8]'
                  }`}
                  onClick={() => setView('map')}
                >
                  {t('drivers.viewMap')}
                </button>
              </div>
              {isAdmin && (
                <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
                  {t('drivers.newDriver')}
                </button>
              )}
            </div>
        </div>
      ) : (
        <PageHeader
          title={t('drivers.title')}
          actions={
            <div className="flex items-center gap-3">
              <div className="flex overflow-hidden rounded-lg border border-[#d6dae0]">
                <button
                  type="button"
                  className={`px-3 py-1.5 text-sm font-semibold transition-colors ${
                    view === 'list'
                      ? 'bg-[#14181f] text-white'
                      : 'bg-white text-[#5b6470] hover:bg-[#f5f6f8]'
                  }`}
                  onClick={() => setView('list')}
                >
                  {t('drivers.viewList')}
                </button>
                <button
                  type="button"
                  className={`px-3 py-1.5 text-sm font-semibold transition-colors ${
                    view === 'map'
                      ? 'bg-[#14181f] text-white'
                      : 'bg-white text-[#5b6470] hover:bg-[#f5f6f8]'
                  }`}
                  onClick={() => setView('map')}
                >
                  {t('drivers.viewMap')}
                </button>
              </div>
              {isAdmin && (
                <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
                  {t('drivers.newDriver')}
                </button>
              )}
            </div>
          }
        />
      )}
      {!embedded && (
        <Tabs<Bolim>
          tabs={[
            { value: 'list', label: t('drivers.tabList') },
            { value: 'analytics', label: t('nav.analytics') },
            { value: 'track', label: t('nav.track') },
          ]}
          active={bolim}
          onChange={(k) => setAddr(k === 'list' ? {} : { bolim: k }, { replace: true })}
        />
      )}
      {bolim === 'analytics' ? (
        <DriverAnalyticsPage embedded />
      ) : bolim === 'track' ? (
        <DriverTrackPage embedded />
      ) : view === 'list' ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            {isAdmin && <DismissedToggle on={dismissed} onChange={setDismissed} />}
            <div className="min-w-[200px] flex-1">
              <SearchInput value={search} onChange={setSearch} placeholder={t('drivers.search')} />
            </div>
          </div>
          {rehireM.isError ? <ErrorNote error={rehireM.error} /> : null}
          <Card>
            {isLoading ? (
              <Spinner />
            ) : data.length === 0 ? (
              <EmptyState
                title={q ? t('common.noResults') : t('drivers.noDrivers')}
                hint={q ? t('common.noResultsHint') : t('drivers.noDriversHint')}
              />
            ) : (
              <DataTable
                columns={columns}
                rows={data}
                keyOf={(d) => d.id}
                // In Foydalanuvchilar a row opens the account, as a seller's does.
                onRowClick={embedded ? (d) => setEditing(d) : canViewDetail ? (d) => navigate(`/drivers/${d.id}`) : undefined}
              />
            )}
          </Card>
        </>
      ) : null}
      {mapSeen && (
        <div hidden={view !== 'map'}>
          <Suspense fallback={<Spinner />}>
            <DriversMap />
          </Suspense>
        </div>
      )}

      {/* Editing and removing a driver live on his own page now: the list is for
          finding him, and a delete sitting a few pixels from a name is how the
          wrong driver gets deleted. */}
      <DriverFormModal open={createOpen} onClose={() => setCreateOpen(false)} />
      {/* From Foydalanuvchilar the pencil opens the account only — name, phone,
          password; from the Haydovchilar page, the full driver form. */}
      {embedded ? (
        <DriverAccountModal driver={editing} onClose={() => setEditing(null)} />
      ) : (
        <DriverFormModal open={!!editing} editing={editing} onClose={() => setEditing(null)} />
      )}
      <ConfirmDialog
        open={!!deleting}
        title={t('team.dismissAsk', { name: deleting?.name ?? '' })}
        pending={deleteM.isPending}
        error={deleteM.isError ? deleteM.error : undefined}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteM.mutate(deleting.id)}
      />
    </div>
  );
}
