import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ServiceReason } from '@bigant/shared';
import { api } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';
import { Card, DataTable, EmptyState, ErrorNote, Field, Spinner, type Column } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { day } from '../fuel/fuelShared';
import { km } from './serviceShared';

/**
 * The works a driver can tick, each with its km interval — one interval for
 * every truck, for now. A work without one has no schedule; it just sits in
 * the list. Reasons drivers typed in land below, for admin to promote or
 * leave as one-offs.
 */
export function ServiceCatalogTab() {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<ServiceReason | null | 'new'>(null);

  const q = useQuery({ queryKey: ['service', 'reasons', 'all'], queryFn: () => api.get<ServiceReason[]>('/service/reasons/all') });
  const all = q.data ?? [];
  const approved = all.filter((r) => r.approved);
  const suggested = all.filter((r) => !r.approved);

  const promoteM = useMutation({
    mutationFn: (r: ServiceReason) => api.patch<ServiceReason>(`/service/reasons/${r.id}`, { approved: true }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['service', 'reasons'] }),
  });

  const columns: Column<ServiceReason>[] = [
    { key: 'name', header: t('service.catalog.colWork'), render: (r) => <span className={r.active ? 'font-medium' : 'text-slate-light'}>{r.name}</span> },
    {
      key: 'interval',
      header: t('service.catalog.colInterval'),
      render: (r) => (r.interval_km != null ? <span className="font-mono">{km(r.interval_km)} km</span> : <span className="text-slate-light">{t('service.catalog.noInterval')}</span>),
    },
    {
      key: 'active',
      header: t('service.catalog.colState'),
      render: (r) => (
        <span className="inline-flex items-center gap-1.5 text-xs">
          <span className={`inline-block h-2 w-2 rounded-full ${r.active ? 'bg-[#15803d]' : 'bg-slate-light'}`} />
          {r.active ? t('fuel.stations.active') : t('fuel.stations.inactive')}
        </span>
      ),
    },
    { key: 'edit', header: '', className: 'text-right', render: (r) => <button type="button" className="btn-ghost" onClick={() => setEditing(r)}>{t('fuel.stations.edit')}</button> },
  ];

  return (
    <>
      <div className="mb-4 flex items-start justify-end gap-4">
        <button type="button" className="btn-primary flex-none" onClick={() => setEditing('new')}>{t('service.catalog.add')}</button>
      </div>
      <Card>
        {q.isLoading ? <Spinner /> : approved.length === 0 ? <EmptyState title={t('service.catalog.empty')} /> : <DataTable columns={columns} rows={approved} keyOf={(r) => r.id} />}
      </Card>

      {suggested.length > 0 && (
        <>
          <div className="mb-1 mt-6 text-[11px] font-bold uppercase tracking-wider text-slate-light">{t('service.catalog.suggested')}</div>
          <Card>
            <div className="divide-y divide-mist">
              {suggested.map((r) => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-slate">{[r.created_by_driver_name, day(r.created_at)].filter(Boolean).join(' · ')}</div>
                  </div>
                  <button type="button" className="btn-primary" disabled={promoteM.isPending} onClick={() => promoteM.mutate(r)}>{t('service.catalog.promote')}</button>
                  <button type="button" className="btn-ghost" onClick={() => setEditing(r)}>{t('service.catalog.promoteWithInterval')}</button>
                </div>
              ))}
            </div>
            {promoteM.isError && <div className="px-4 pb-3"><ErrorNote error={promoteM.error} /></div>}
          </Card>
        </>
      )}

      <ReasonFormModal reason={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function ReasonFormModal({ reason, onClose }: { reason: ServiceReason | null | 'new'; onClose: () => void }) {
  const { t } = useTranslation();
  const open = reason !== null;
  const existing = reason && reason !== 'new' ? reason : null;
  const [name, setName] = useState('');
  const [interval, setInterval_] = useState('');
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? '');
    setInterval_(existing?.interval_km != null ? String(existing.interval_km) : '');
    setActive(existing?.active ?? true);
  }, [open, existing]);

  const n = Number(interval.replace(/\s/g, ''));
  const intervalOk = interval.trim() === '' || (Number.isInteger(n) && n > 0);

  const saveM = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), interval_km: interval.trim() === '' ? null : n, active, ...(existing && !existing.approved ? { approved: true } : {}) };
      return existing ? api.patch<ServiceReason>(`/service/reasons/${existing.id}`, body) : api.post<ServiceReason>('/service/reasons', body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['service', 'reasons'] });
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title={existing ? t('service.catalog.formEdit') : t('service.catalog.formNew')}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (intervalOk) saveM.mutate();
        }}
        className="grid gap-4"
      >
        <Field label={t('service.catalog.name')}>
          <input id="rs-name" className="input" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('service.catalog.interval')}>
          <div className="flex items-center gap-2">
            <input id="rs-interval" className="input font-mono" inputMode="numeric" placeholder="—" value={interval} onChange={(e) => setInterval_(e.target.value)} />
            <span className="text-sm text-slate">km</span>
          </div>
          {!intervalOk && <p className="mt-1 text-xs text-[#dc2626]">{t('service.catalog.intervalBad')}</p>}
        </Field>
        <label className={`inline-flex cursor-pointer items-center gap-2 self-start rounded-lg border px-3 py-2 text-sm font-semibold ${active ? 'border-brand bg-brand-tint text-brandDark' : 'border-mist text-graphite'}`}>
          <input type="checkbox" className="accent-brand" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {t('fuel.stations.isActive')}
        </label>
        <div className="flex items-center justify-end gap-2">
          {saveM.isError && <ErrorNote error={saveM.error} />}
          <button type="submit" className="btn-primary" disabled={saveM.isPending}>{t('fuel.stations.save')}</button>
          <button type="button" className="btn-ghost" onClick={onClose}>{t('fuel.stations.cancel')}</button>
        </div>
      </form>
    </Modal>
  );
}
