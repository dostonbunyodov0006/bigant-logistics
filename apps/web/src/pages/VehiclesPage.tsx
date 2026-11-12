import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { VehiclePage, VehiclePublic } from '@bigant/shared';
import { api } from '../lib/api';
import { Card, DataTable, EmptyState, PageHeader, Spinner, Tabs, type Column } from '../components/ui';
import { ServicePage } from './ServicePage';
import { DocumentsPage } from './DocumentsPage';

type Bolim = 'vehicles' | 'service' | 'documents';
import { SearchInput } from '../components/SearchInput';
import { Pager } from '../components/Pager';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { VehicleFormModal } from '../components/forms/VehicleFormModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ItemActions } from '../components/ItemActions';
import { queryClient } from '../lib/queryClient';

function StatusPill({ status }: { status: VehiclePublic['status'] }) {
  const { t } = useTranslation();
  const tone: Record<VehiclePublic['status'], string> = {
    active: 'bg-[#e6f6ec] text-[#15803d]',
    maintenance: 'bg-[#fef6e7] text-[#a15c07]',
    inactive: 'bg-[#f0f1f3] text-[#8a93a0]',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone[status]}`}>
      {t(`vehicleStatus.${status}`)}
    </span>
  );
}

const PAGE = 25;

export function VehiclesPage() {
  // Servis and Hujjatlar are tabs of Transport, not menu entries (owner,
  // 02.11.2026): both belong to a lorry. The pick is in the address
  // (?bolim=service) so a refresh or an old link keeps it.
  const [addr, setAddr] = useSearchParams();
  const bolim: Bolim = addr.get('bolim') === 'service' ? 'service' : addr.get('bolim') === 'documents' ? 'documents' : 'vehicles';
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<VehiclePublic | null>(null);
  const [deleting, setDeleting] = useState<VehiclePublic | null>(null);
  const deleteM = useMutation({
    mutationFn: (id: string) => api.del(`/vehicles/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      setDeleting(null);
    },
  });
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search, 250);
  const [page, setPage] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ['vehicles', 'page', q, page],
    queryFn: () =>
      api.get<VehiclePage>(
        `/vehicles/page?skip=${page * PAGE}&take=${PAGE}${q ? `&search=${encodeURIComponent(q)}` : ''}`,
      ),
    refetchInterval: 15_000,
    placeholderData: (prev) => prev,
  });
  const rows = data?.items ?? [];
  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE));

  const columns: Column<VehiclePublic>[] = [
    {
      key: 'plate',
      header: t('vehicles.colPlate'),
      render: (v) => (
        <div className="flex items-center gap-2">
          <span className="font-mono font-medium text-brand">{v.plate_number}</span>
          {v.docs_expiry_alert && (
            <span
              title={
                v.docs_expiry_alert === 'expired'
                  ? t('vehicles.docExpired')
                  : t('vehicles.docExpiring')
              }
              className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${
                v.docs_expiry_alert === 'expired'
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
    { key: 'model', header: t('vehicles.colModel'), render: (v) => <span className="text-ink">{v.model}</span> },
    { key: 'type', header: t('vehicles.colType'), render: (v) => <span className="text-slate">{t(`vehicleType.${v.type}`)}</span> },
    {
      key: 'techPassport',
      header: t('vehicleForm.techPassport'),
      render: (v) => <span className="font-mono text-slate">{v.tech_passport ?? '—'}</span>,
    },
    {
      key: 'capacity',
      header: t('vehicles.colCapacity'),
      render: (v) => <span className="font-mono text-slate">{v.capacity_kg != null ? `${v.capacity_kg} kg` : '—'}</span>,
    },
    { key: 'status', header: t('vehicles.colStatus'), render: (v) => <StatusPill status={v.status} /> },
    // Edit and delete on the row, as on the lorry's own page; the row opens
    // that page, so the buttons keep their clicks to themselves.
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (v) => (
        <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
          <ItemActions
            size="sm"
            onEdit={() => setEditing(v)}
            onDelete={v.status !== 'inactive' ? () => setDeleting(v) : undefined}
            deleteIcon="block"
            deleteLabel={t('vehicles.deleteTitle')}
          />
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('vehicles.title')}
        actions={
          bolim === 'vehicles' ? (
            <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
              {t('vehicles.newVehicle')}
            </button>
          ) : undefined
        }
      />
      <Tabs<Bolim>
        tabs={[
          { value: 'vehicles', label: t('vehicles.tabList') },
          { value: 'service', label: t('nav.service') },
          { value: 'documents', label: t('nav.documents') },
        ]}
        active={bolim}
        onChange={(k) => setAddr(k === 'vehicles' ? {} : { bolim: k }, { replace: true })}
      />
      {bolim === 'service' ? (
        <ServicePage embedded />
      ) : bolim === 'documents' ? (
        <DocumentsPage embedded />
      ) : (
        <>
      <div className="mb-4">
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(0);
          }}
          placeholder={t('vehicles.search')}
        />
      </div>

      <Card>
        {isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState
            title={q ? t('common.noResults') : t('vehicles.noVehicles')}
            hint={q ? t('common.noResultsHint') : t('vehicles.noVehiclesHint')}
          />
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={rows}
              keyOf={(v) => v.id}
              onRowClick={(v) => navigate(`/vehicles/${v.id}`)}
            />
            <Pager page={page} count={pageCount} onPage={setPage} size="lg" />
          </>
        )}
      </Card>

      <VehicleFormModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <VehicleFormModal open={!!editing} editing={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={!!deleting}
        title={t('vehicles.deleteTitle')}
        message={t('vehicles.deleteMessage', { plate: deleting?.plate_number ?? '' })}
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
