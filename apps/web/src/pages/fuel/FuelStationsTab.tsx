import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  FUEL_TYPES,
  type Coordinates,
  type FuelStation,
  type FuelStationTotal,
  type FuelType,
} from '@bigant/shared';
import { api } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';
import { Card, DataTable, EmptyState, ErrorNote, Field, Spinner, type Column } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { LocationPickerLazy } from '../../components/LocationPickerLazy';
import { useFuelLabels } from './fuelShared';
import type { Period } from '../FuelPage';

/** Tashkent city — where the map opens for a new station until a pin exists. */
const TASHKENT_REGION = '1726';

/**
 * The contracted list. A station is never deleted — its logs point at it — it
 * is switched off, and the driver's pickers stop offering it.
 */
export function FuelStationsTab({ period }: { period: Period }) {
  const { t } = useTranslation();
  const L = useFuelLabels();
  const [editing, setEditing] = useState<FuelStation | null | 'new'>(null);

  const q = useQuery({ queryKey: ['fuel', 'stations', 'all'], queryFn: () => api.get<FuelStation[]>('/fuel/stations/all') });
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(period).filter(([, v]) => v)) as Record<string, string>).toString();
  const totalsQ = useQuery({
    queryKey: ['fuel', 'settlement', 'stations', qs],
    queryFn: () => api.get<FuelStationTotal[]>(`/fuel/settlement/stations${qs ? `?${qs}` : ''}`),
  });
  const countOf = (id: string) => totalsQ.data?.find((r) => r.station.id === id)?.count ?? 0;

  const columns: Column<FuelStation>[] = [
    {
      key: 'name',
      header: t('fuel.stations.colStation'),
      render: (s) => (
        <div>
          <div className="font-medium">{s.name}</div>
          <div className="text-xs text-slate">{[s.brand, s.address].filter(Boolean).join(' · ')}</div>
        </div>
      ),
    },
    {
      key: 'fuels',
      header: t('fuel.stations.colFuels'),
      render: (s) => (
        <span className="flex flex-wrap gap-1">
          {s.fuel_types.map((f) => (
            <span key={f} className="rounded bg-[#eef1f5] px-2 py-0.5 text-xs font-semibold">{L.fuel(f)}</span>
          ))}
        </span>
      ),
    },
    {
      key: 'pin',
      header: t('fuel.stations.colPin'),
      render: (s) =>
        s.lat != null ? (
          <span className="text-xs font-semibold text-[#15803d]">{t('fuel.stations.pinned')}</span>
        ) : (
          <span className="text-xs font-semibold text-[#a15c07]">{t('fuel.stations.unpinned')}</span>
        ),
    },
    { key: 'count', header: t('fuel.stations.colCount'), className: 'text-right', render: (s) => <span className="font-mono">{countOf(s.id)}</span> },
    {
      key: 'active',
      header: t('fuel.stations.colActive'),
      render: (s) => (
        <span className="inline-flex items-center gap-1.5 text-xs">
          <span className={`inline-block h-2 w-2 rounded-full ${s.active ? 'bg-[#15803d]' : 'bg-slate-light'}`} />
          {s.active ? t('fuel.stations.active') : t('fuel.stations.inactive')}
        </span>
      ),
    },
    {
      key: 'edit',
      header: '',
      className: 'text-right',
      render: (s) => (
        <button type="button" className="btn-ghost" onClick={() => setEditing(s)}>{t('fuel.stations.edit')}</button>
      ),
    },
  ];

  const rows = q.data ?? [];
  return (
    <>
      <div className="mb-4 flex items-start justify-between gap-4">
        <button type="button" className="btn-primary flex-none" onClick={() => setEditing('new')}>
          {t('fuel.stations.add')}
        </button>
      </div>
      <Card>
        {q.isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState title={t('fuel.stations.empty')} hint={t('fuel.stations.emptyHint')} />
        ) : (
          <DataTable columns={columns} rows={rows} keyOf={(s) => s.id} />
        )}
      </Card>
      <StationFormModal station={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function StationFormModal({ station, onClose }: { station: FuelStation | null | 'new'; onClose: () => void }) {
  const { t } = useTranslation();
  const L = useFuelLabels();
  const open = station !== null;
  const existing = station && station !== 'new' ? station : null;

  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [address, setAddress] = useState('');
  const [fuels, setFuels] = useState<FuelType[]>(['gaz']);
  const [contracted, setContracted] = useState(true);
  const [active, setActive] = useState(true);
  const [pin, setPin] = useState<Coordinates | null>(null);
  const [fuelError, setFuelError] = useState(false);

  // Reset on every open: the form belongs to whichever station it was opened for.
  useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? '');
    setBrand(existing?.brand ?? '');
    setAddress(existing?.address ?? '');
    setFuels(existing?.fuel_types ?? ['gaz']);
    setContracted(existing?.contracted ?? true);
    setActive(existing?.active ?? true);
    setPin(existing?.lat != null && existing.lng != null ? { lat: existing.lat, lng: existing.lng } : null);
    setFuelError(false);
  }, [open, existing]);

  const saveM = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        brand: brand.trim() || null,
        address: address.trim() || null,
        lat: pin?.lat ?? null,
        lng: pin?.lng ?? null,
        fuel_types: fuels,
        contracted,
        active,
      };
      return existing
        ? api.patch<FuelStation>(`/fuel/stations/${existing.id}`, body)
        : api.post<FuelStation>('/fuel/stations', body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['fuel', 'stations'] });
      onClose();
    },
  });

  const toggleFuel = (f: FuelType) => {
    setFuels((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]));
    setFuelError(false);
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (fuels.length === 0) {
      setFuelError(true);
      return;
    }
    saveM.mutate();
  };

  return (
    <Modal open={open} onClose={onClose} title={existing ? t('fuel.stations.formEdit') : t('fuel.stations.formNew')} size="xl">
      <form onSubmit={submit} className="grid gap-5 lg:grid-cols-2">
        <div className="grid content-start gap-3">
          <Field label={t('fuel.stations.name')}>
            <input id="st-name" className="input" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('fuel.stations.brand')}>
              <input id="st-brand" className="input" maxLength={80} value={brand} onChange={(e) => setBrand(e.target.value)} />
            </Field>
            <Field label={t('fuel.stations.address')}>
              <input id="st-address" className="input" maxLength={240} value={address} onChange={(e) => setAddress(e.target.value)} />
            </Field>
          </div>
          <div>
            <div className="field-label">{t('fuel.stations.fuels')}</div>
            <div className="flex flex-wrap gap-2">
              {FUEL_TYPES.map((f) => (
                <label
                  key={f}
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold ${
                    fuels.includes(f) ? 'border-brand bg-brand-tint text-brandDark' : 'border-mist text-graphite'
                  }`}
                >
                  <input type="checkbox" className="accent-brand" checked={fuels.includes(f)} onChange={() => toggleFuel(f)} />
                  {L.fuel(f)}
                </label>
              ))}
            </div>
            {fuelError && <div className="mt-1 text-xs text-[#dc2626]">{t('fuel.stations.needFuel')}</div>}
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
              inputId="st-pin"
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
