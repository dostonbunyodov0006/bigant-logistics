import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { PickupPlacePublic } from '@bigant/shared';
import { api } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { useAuth } from '../auth/AuthContext';
import { Card, DataTable, EmptyState, PageHeader, Spinner, type Column } from '../components/ui';
import { NoLocationBadge } from '../components/NoLocationBadge';
import { PickupPlaceFormModal } from '../components/forms/PickupPlaceFormModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ItemActions } from '../components/ItemActions';
import { SuppliersCard } from '../components/SuppliersCard';

export function PickupPlacesPage() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<PickupPlacePublic | null>(null);
  const [deleting, setDeleting] = useState<PickupPlacePublic | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ['pickup-places'],
    queryFn: () => api.get<PickupPlacePublic[]>('/pickup-places'),
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => api.del(`/pickup-places/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pickup-places'] });
      setDeleting(null);
    },
  });

  // The server lets a manager do this; see roles.guard.ts.
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';

  const columns: Column<PickupPlacePublic>[] = [
    { key: 'name', header: t('pickupPlaces.colPlace'), render: (p) => <span className="font-medium text-ink">{p.name}</span> },
    {
      key: 'type',
      header: t('pickupPlaces.colType'),
      render: (p) => (
        <span className="rounded-md border border-mist bg-paper px-2 py-0.5 text-xs font-medium text-graphite">
          {t(`pickupPlaceType.${p.type}`)}
        </span>
      ),
    },
    {
      key: 'address',
      header: t('pickupPlaces.colAddress'),
      render: (p) => (
        <span className="flex items-center gap-2 text-slate">
          <span>{p.address ?? '—'}</span>
          {p.lat == null && <NoLocationBadge />}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (p) =>
        isAdmin ? (
          <div className="flex justify-end gap-2">
            <ItemActions size="sm" onEdit={() => setEditing(p)} onDelete={() => setDeleting(p)} />
          </div>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('pickupPlaces.title')}
        actions={
          <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
            {t('pickupPlaces.newPickupPlace')}
          </button>
        }
      />
      <Card>
        {isLoading ? (
          <Spinner />
        ) : data.length === 0 ? (
          <EmptyState title={t('pickupPlaces.noPlaces')} hint={t('pickupPlaces.noPlacesHint')} />
        ) : (
          <DataTable columns={columns} rows={data} keyOf={(p) => p.id} />
        )}
      </Card>
      <div className="mt-6">
        <SuppliersCard />
      </div>

      <PickupPlaceFormModal
        open={createOpen || !!editing}
        editing={editing}
        onClose={() => {
          setCreateOpen(false);
          setEditing(null);
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        title={t('pickupPlaces.deleteTitle')}
        message={t('pickupPlaces.deleteMessage', { name: deleting?.name ?? '' })}
        pending={deleteM.isPending}
        error={deleteM.isError ? deleteM.error : undefined}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteM.mutate(deleting.id)}
      />
    </div>
  );
}
