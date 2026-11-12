import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Coordinates, ServiceCenter, ServiceCenterTotal, ServiceDriverDebt } from '@bigant/shared';
import { api } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';
import { Card, DataTable, EmptyState, ErrorNote, Field, Spinner, type Column } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { LocationPickerLazy } from '../../components/LocationPickerLazy';
import { day, money } from '../fuel/fuelShared';
import type { Period } from '../FuelPage';

const TASHKENT_REGION = '1726';

/**
 * The contracted centres, with what each one is owed this period, and the
 * drivers who paid from their own pocket and are owed back. A centre is never
 * deleted — visits point at it — it is switched off.
 */
export function ServiceCentersTab({ period }: { period: Period }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<ServiceCenter | null | 'new'>(null);

  const q = useQuery({ queryKey: ['service', 'centers', 'all'], queryFn: () => api.get<ServiceCenter[]>('/service/centers/all') });
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(period).filter(([, v]) => v)) as Record<string, string>).toString();
  const totalsQ = useQuery({ queryKey: ['service', 'settlement', 'centers', qs], queryFn: () => api.get<ServiceCenterTotal[]>(`/service/settlement/centers${qs ? `?${qs}` : ''}`) });
  const debtsQ = useQuery({ queryKey: ['service', 'settlement', 'drivers'], queryFn: () => api.get<ServiceDriverDebt[]>('/service/settlement/drivers') });
  const totalOf = (id: string) => totalsQ.data?.find((r) => r.center.id === id);

  const payM = useMutation({
    mutationFn: (driverId: string) => api.post(`/service/settlement/drivers/${driverId}/pay`, {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['service'] }),
  });

  const columns: Column<ServiceCenter>[] = [
    {
      key: 'name',
      header: t('service.centers.colCenter'),
      render: (c) => (
        <div>
          <div className="font-medium">{c.name}</div>
          <div className="text-xs text-slate">{[c.brand, c.address].filter(Boolean).join(' · ')}</div>
        </div>
      ),
    },
    {
      key: 'pin',
      header: t('fuel.stations.colPin'),
      render: (c) => (c.lat != null ? <span className="text-xs font-semibold text-[#15803d]">{t('fuel.stations.pinned')}</span> : <span className="text-xs font-semibold text-[#a15c07]">{t('fuel.stations.unpinned')}</span>),
    },
    { key: 'count', header: t('service.centers.colCount'), className: 'text-right', render: (c) => <span className="font-mono">{totalOf(c.id)?.count ?? 0}</span> },
    { key: 'total', header: t('service.centers.colTotal'), className: 'text-right', render: (c) => <span className="font-mono font-semibold">{money(totalOf(c.id)?.total_sum ?? 0)}</span> },
    {
      key: 'active',
      header: t('fuel.stations.colActive'),
      render: (c) => (
        <span className="inline-flex items-center gap-1.5 text-xs">
          <span className={`inline-block h-2 w-2 rounded-full ${c.active ? 'bg-[#15803d]' : 'bg-slate-light'}`} />
          {c.active ? t('fuel.stations.active') : t('fuel.stations.inactive')}
        </span>
      ),
    },
    { key: 'edit', header: '', className: 'text-right', render: (c) => <button type="button" className="btn-ghost" onClick={() => setEditing(c)}>{t('fuel.stations.edit')}</button> },
  ];

  const debtCols: Column<ServiceDriverDebt>[] = [
    { key: 'driver', header: t('service.visits.colDriver'), render: (d) => <span><b>{d.driver_name ?? '—'}</b>{d.vehicle_plate ? ` · ${d.vehicle_plate}` : ''}</span> },
    { key: 'count', header: t('service.centers.colCount'), className: 'text-right', render: (d) => <span className="font-mono">{d.count}</span> },
    { key: 'oldest', header: t('service.centers.colOldest'), render: (d) => day(d.oldest_at) },
    { key: 'total', header: t('service.centers.colOwed'), className: 'text-right', render: (d) => <span className="font-mono font-semibold text-brandDark">{money(d.total_sum)}</span> },
    {
      key: 'pay',
      header: '',
      className: 'text-right',
      render: (d) => (
        <button
          type="button"
          className="btn-primary"
          disabled={payM.isPending}
          onClick={() => {
            if (window.confirm(t('service.centers.payConfirm', { name: d.driver_name ?? '', sum: money(d.total_sum) }))) payM.mutate(d.driver_id);
          }}
        >
          {t('service.centers.pay')}
        </button>
      ),
    },
  ];

  const rows = q.data ?? [];
  const debts = debtsQ.data ?? [];
  return (
    <>
      <div className="mb-4 flex items-start justify-end gap-4">
        <button type="button" className="btn-primary flex-none" onClick={() => setEditing('new')}>{t('service.centers.add')}</button>
      </div>
      <Card>
        {q.isLoading ? <Spinner /> : rows.length === 0 ? <EmptyState title={t('service.centers.empty')} /> : <DataTable columns={columns} rows={rows} keyOf={(c) => c.id} />}
      </Card>

      <div className="mb-1 mt-6 text-[11px] font-bold uppercase tracking-wider text-slate-light">{t('service.centers.debts')}</div>
      <Card>
        {debtsQ.isLoading ? <Spinner /> : debts.length === 0 ? <EmptyState title={t('service.centers.noDebts')} /> : <DataTable columns={debtCols} rows={debts} keyOf={(d) => d.driver_id} />}
        {payM.isError && <div className="px-4 pb-3"><ErrorNote error={payM.error} /></div>}
      </Card>

      <CenterFormModal center={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function CenterFormModal({ center, onClose }: { center: ServiceCenter | null | 'new'; onClose: () => void }) {
  const { t } = useTranslation();
  const open = center !== null;
  const existing = center && center !== 'new' ? center : null;
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [address, setAddress] = useState('');
  const [contracted, setContracted] = useState(true);
  const [active, setActive] = useState(true);
  const [pin, setPin] = useState<Coordinates | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? '');
    setBrand(existing?.brand ?? '');
    setAddress(existing?.address ?? '');
    setContracted(existing?.contracted ?? true);
    setActive(existing?.active ?? true);
    setPin(existing?.lat != null && existing.lng != null ? { lat: existing.lat, lng: existing.lng } : null);
  }, [open, existing]);

  const saveM = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), brand: brand.trim() || null, address: address.trim() || null, lat: pin?.lat ?? null, lng: pin?.lng ?? null, contracted, active };
      return existing ? api.patch<ServiceCenter>(`/service/centers/${existing.id}`, body) : api.post<ServiceCenter>('/service/centers', body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['service', 'centers'] });
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title={existing ? t('service.centers.formEdit') : t('service.centers.formNew')} size="xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          saveM.mutate();
        }}
        className="grid gap-5 lg:grid-cols-2"
      >
        <div className="grid content-start gap-3">
          <Field label={t('fuel.stations.name')}>
            <input id="sc-name" className="input" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('fuel.stations.brand')}>
              <input id="sc-brand" className="input" maxLength={80} value={brand} onChange={(e) => setBrand(e.target.value)} />
            </Field>
            <Field label={t('fuel.stations.address')}>
              <input id="sc-address" className="input" maxLength={240} value={address} onChange={(e) => setAddress(e.target.value)} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold ${contracted ? 'border-brand bg-brand-tint text-brandDark' : 'border-mist text-graphite'}`}>
              <input type="checkbox" className="accent-brand" checked={contracted} onChange={(e) => setContracted(e.target.checked)} />
              {t('fuel.stations.contracted')}
            </label>
            <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold ${active ? 'border-brand bg-brand-tint text-brandDark' : 'border-mist text-graphite'}`}>
              <input type="checkbox" className="accent-brand" checked={active} onChange={(e) => setActive(e.target.checked)} />
              {t('fuel.stations.isActive')}
            </label>
          </div>
        </div>
        <div className="grid content-start gap-2">
          <div className="flex items-baseline justify-between">
            <div className="field-label mb-0">{t('fuel.stations.pin')}</div>
            {pin && <span className="font-mono text-xs text-slate">{pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}</span>}
          </div>
          {open && (
            <LocationPickerLazy
              value={pin}
              onChange={setPin}
              onAddress={(a) => {
                if (!address.trim()) setAddress(a);
              }}
              regionCode={TASHKENT_REGION}
              inputId="sc-pin"
            />
          )}
        </div>
        <div className="flex items-center justify-end gap-2 lg:col-span-2">
          {saveM.isError && <ErrorNote error={saveM.error} />}
          <button type="submit" className="btn-primary" disabled={saveM.isPending}>{t('fuel.stations.save')}</button>
          <button type="button" className="btn-ghost" onClick={onClose}>{t('fuel.stations.cancel')}</button>
        </div>
      </form>
    </Modal>
  );
}
