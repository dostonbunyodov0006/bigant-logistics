import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { CargoTypePublic } from '@bigant/shared';
import { api } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { Card, DataTable, EmptyState, Spinner, type Column } from './ui';
import { CargoTypeFormModal } from './forms/CargoTypeFormModal';
import { ConfirmDialog } from './ConfirmDialog';
import { ItemActions } from './ItemActions';

/**
 * Cargo type reference data. This was a top-level sidebar page, but it is
 * set-once configuration like the tariffs and work schedule next to it.
 */
export function CargoTypesCard() {
  const { t } = useTranslation();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CargoTypePublic | null>(null);
  const [deleting, setDeleting] = useState<CargoTypePublic | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ['cargo-types'],
    queryFn: () => api.get<CargoTypePublic[]>('/cargo-types'),
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => api.del(`/cargo-types/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['cargo-types'] });
      setDeleting(null);
    },
  });

  const columns: Column<CargoTypePublic>[] = [
    { key: 'name', header: t('cargoTypes.colName'), render: (c) => <span className="font-medium text-ink">{c.name}</span> },
    {
      key: 'status',
      header: t('cargoTypes.colStatus'),
      render: (c) => (
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c.active ? 'bg-[#e6f6ec] text-[#15803d]' : 'bg-[#f0f1f3] text-[#8a93a0]'}`}>
          {c.active ? t('cargoTypes.active') : t('cargoTypes.inactive')}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (c) => (
        <div className="flex justify-end gap-2">
          <ItemActions
            size="sm"
            onEdit={() => {
              setEditing(c);
              setFormOpen(true);
            }}
            onDelete={() => setDeleting(c)}
          />
        </div>
      ),
    },
  ];

  return (
    <Card className="max-w-2xl">
      <div className="flex flex-wrap items-end justify-between gap-3 p-5 pb-4">
        <div>
          <h2 className="font-display text-lg font-bold tracking-tight">{t('cargoTypes.title')}</h2>
        </div>
        <button type="button" className="btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
          {t('cargoTypes.newType')}
        </button>
      </div>

      {isLoading ? (
        <Spinner />
      ) : data.length === 0 ? (
        <EmptyState title={t('cargoTypes.noData')} hint={t('cargoTypes.noDataHint')} />
      ) : (
        <DataTable columns={columns} rows={data} keyOf={(c) => c.id} />
      )}

      <CargoTypeFormModal open={formOpen} editing={editing} onClose={() => setFormOpen(false)} />
      <ConfirmDialog
        open={!!deleting}
        title={t('cargoTypes.deleteTitle')}
        message={t('cargoTypes.deleteMessage', { name: deleting?.name ?? '' })}
        pending={deleteM.isPending}
        error={deleteM.isError ? deleteM.error : undefined}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteM.mutate(deleting.id)}
      />
    </Card>
  );
}
