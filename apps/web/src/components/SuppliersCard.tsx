import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { SupplierPublic } from '@bigant/shared';
import { api } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { Card, EmptyState, ErrorNote, Field, Spinner } from './ui';
import { Modal } from './Modal';
import { ItemActions } from './ItemActions';

/**
 * The suppliers goods are collected from.
 *
 * A supplier often loads from several yards. Each yard is a pickup place that
 * points at its supplier, so the seller reads one name with its gates under
 * it instead of three near-identical entries in a flat list.
 */
export function SuppliersCard() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SupplierPublic | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const { data = [], isLoading } = useQuery({
    queryKey: ['suppliers', 'all'],
    queryFn: () => api.get<SupplierPublic[]>('/pickup-places/suppliers/all'),
  });

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), phone_number: phone.trim() || null };
      return editing
        ? api.patch<SupplierPublic>(`/pickup-places/suppliers/${editing.id}`, body)
        : api.post<SupplierPublic>('/pickup-places/suppliers', body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      void queryClient.invalidateQueries({ queryKey: ['pickup-places'] });
      setOpen(false);
    },
  });

  const start = (supplier: SupplierPublic | null) => {
    setEditing(supplier);
    setName(supplier?.name ?? '');
    setPhone(supplier?.phone_number ?? '');
    save.reset();
    setOpen(true);
  };

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">{t('suppliers.title')}</h2>
        </div>
        <button type="button" className="btn-primary shrink-0" onClick={() => start(null)}>
          {t('suppliers.add')}
        </button>
      </div>

      {isLoading ? (
        <Spinner />
      ) : data.length === 0 ? (
        <EmptyState title={t('suppliers.none')} hint={t('suppliers.noneHint')} />
      ) : (
        <ul className="divide-y divide-mist">
          {data.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 py-3">
              <div className="min-w-0">
                <div className="font-medium text-ink">{s.name}</div>
                <div className="text-sm text-slate">
                  {[s.phone_number, t('suppliers.placesCount', { count: s.places_count })]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
              <div className="shrink-0">
                <ItemActions size="sm" onEdit={() => start(s)} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? t('suppliers.editTitle') : t('suppliers.newTitle')}
      >
        <div className="space-y-4">
          {save.isError && <ErrorNote error={save.error} />}
          <Field label={t('suppliers.name')}>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('suppliers.phone')}>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={save.isPending || !name.trim()}
              onClick={() => save.mutate()}
            >
              {save.isPending ? t('common.saving') : t('common.saveChanges')}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
