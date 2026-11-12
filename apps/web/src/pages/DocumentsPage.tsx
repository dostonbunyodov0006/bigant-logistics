import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { DocumentRow, TechPassportRow, VehicleDocType } from '@bigant/shared';
import { api } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { Card, EmptyState, PageHeader, Spinner, Tabs } from '../components/ui';
import { SearchInput } from '../components/SearchInput';
import { DocPhotoSlot } from '../components/DocPhotoSlot';
import { ItemActions } from '../components/ItemActions';
import { daysUntil } from '../lib/tashkent';

/**
 * The fleet's papers, one tab per kind.
 *
 * Nothing is stored here. The tech passport lives on the vehicle, the licence
 * on the driver, the dated papers in the vehicle's documents — so a picture
 * put up on this page appears on the lorry's page and the driver's page at
 * once, and one removed there is gone here. One copy, read from three doors.
 */
// No Tonirovka tab: none of our lorries has tinted glass (owner, 28.10.2026).
type Tab = 'tech' | 'license' | 'texosmotr' | 'gas_inspection' | 'insurance' | 'power_of_attorney' | 'advertising_permit';

/** `embedded`: shown as a tab of Transport, which carries the heading. */
export function DocumentsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('tech');
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();

  return (
    <div>
      {!embedded && <PageHeader title={t('documents.title')} />}
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { value: 'tech', label: t('documents.tabTech') },
          { value: 'license', label: t('documents.tabLicense') },
          { value: 'texosmotr', label: t('vehicleDocType.texosmotr') },
          { value: 'gas_inspection', label: t('documents.tabGas') },
          { value: 'insurance', label: t('vehicleDocType.insurance') },
          { value: 'power_of_attorney', label: t('documents.tabPoa') },
          { value: 'advertising_permit', label: t('documents.tabAd') },
        ]}
      />
      <div className="mb-4">
        <SearchInput value={search} onChange={setSearch} placeholder={t('documents.search')} />
      </div>
      {tab === 'tech' || tab === 'license' ? <PhotoTab kind={tab} q={q} /> : <DatedTab type={tab} q={q} />}
    </div>
  );
}

// --- Tech passport and licence: pictures on the vehicle and the driver ------

function PhotoTab({ kind, q }: { kind: 'tech' | 'license'; q: string }) {
  const { t } = useTranslation();
  const rows = useQuery({
    queryKey: ['fleet-docs'],
    queryFn: () => api.get<TechPassportRow[]>('/fleet-docs'),
  });
  // Tech passports are the lorries'; licences are the drivers', lorry or not.
  const shown = (rows.data ?? []).filter(
    (r) =>
      (kind === 'tech' ? !!r.vehicle_id : !!r.driver_id) &&
      (!q || (r.plate_number ?? '').toLowerCase().includes(q) || (r.driver_name ?? '').toLowerCase().includes(q)),
  );
  if (rows.isLoading) return <Spinner />;
  if (shown.length === 0) return <EmptyState title={t('common.noResults')} hint={t('common.noResultsHint')} />;
  return (
    <div className="flex flex-col gap-4">
      {shown.map((row) => (
        <PhotoCard key={row.vehicle_id ?? row.driver_id ?? ''} row={row} kind={kind} />
      ))}
    </div>
  );
}

function PhotoCard({ row, kind }: { row: TechPassportRow; kind: 'tech' | 'license' }) {
  const { t } = useTranslation();
  // The same calls the vehicle and driver pages make, so every page that
  // shows these pictures is told at once.
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['fleet-docs'] });
    if (row.vehicle_id) void queryClient.invalidateQueries({ queryKey: ['vehicle', row.vehicle_id] });
    void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    if (row.driver_id) void queryClient.invalidateQueries({ queryKey: ['driver', row.driver_id] });
    void queryClient.invalidateQueries({ queryKey: ['drivers'] });
    void queryClient.invalidateQueries({ queryKey: ['seller', 'tech-passports'] });
  };
  const target = kind === 'tech' ? `vehicles/${row.vehicle_id}` : `drivers/${row.driver_id}`;
  const front = kind === 'tech' ? 'tech_front' : 'license_front';
  const back = kind === 'tech' ? 'tech_back' : 'license_back';
  const set = (k: string) => (base64: string) => api.post(`/fleet-docs/${target}/${k}`, { base64 }).then(refresh);
  const clear = (k: string) => () => api.del(`/fleet-docs/${target}/${k}`).then(refresh);
  const frontUrl = kind === 'tech' ? row.tech_passport_front_url : row.license_front_url;
  const backUrl = kind === 'tech' ? row.tech_passport_back_url : row.license_back_url;

  return (
    <Card className="p-4">
      <RowHead row={row} />
      {kind === 'tech' && <Facts row={row} />}
      {kind === 'license' && (
        <div className="mb-3 flex flex-wrap gap-x-4 text-sm text-slate">
          {row.license_category && <span>{t('driverForm.licenseCategory')}: {row.license_category}</span>}
          {row.license_years != null && (
            <span>
              {t('driverDetail.staj')}: {t('driverDetail.years', { n: row.license_years })}
            </span>
          )}
          {row.license_expires_at && (
            <span>
              {t('driverForm.licenseExpires')}: {dmy(row.license_expires_at)}
            </span>
          )}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <DocPhotoSlot label={t('docPhoto.front')} url={frontUrl} onUpload={set(front)} onClear={clear(front)} />
        <DocPhotoSlot label={t('docPhoto.back')} url={backUrl} onUpload={set(back)} onClear={clear(back)} />
      </div>
    </Card>
  );
}

/** What the passport photo does not say: who it is registered to, what it carries, how big the bay is. */
function Facts({ row }: { row: TechPassportRow }) {
  const { t } = useTranslation();
  const size =
    row.length_cm && row.width_cm && row.height_cm ? `${row.length_cm} × ${row.width_cm} × ${row.height_cm} sm` : null;
  return (
    <div className="mb-3 flex flex-wrap gap-x-4 text-sm text-slate">
      {row.owner && <span>{t('vehicleForm.owner')}: <span className="text-ink">{row.owner}</span></span>}
      {row.capacity_kg != null && <span>{t('documents.load')}: <span className="text-ink">{row.capacity_kg} kg</span></span>}
      {size && <span>{t('documents.size')}: <span className="text-ink">{size}</span></span>}
    </div>
  );
}

function RowHead({
  row,
}: {
  row: { driver_id?: string | null; driver_name: string | null; vehicle_id: string | null; plate_number: string | null; model: string | null };
}) {
  const { t } = useTranslation();
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
      {row.driver_id ? (
        <Link to={`/drivers/${row.driver_id}`} className="text-base font-semibold text-brand hover:underline">
          {row.driver_name}
        </Link>
      ) : (
        <span className="text-base font-semibold text-slate-light">{row.driver_name ?? t('vehicleDetail.noDriver')}</span>
      )}
      {row.vehicle_id ? (
        <Link to={`/vehicles/${row.vehicle_id}`} className="font-mono text-sm text-ink hover:underline">
          {row.plate_number} · {row.model}
        </Link>
      ) : (
        <span className="text-sm text-slate-light">{t('documents.noVehicle')}</span>
      )}
    </div>
  );
}

// --- Dated papers: inspection, gas, insurance, power of attorney, tint ------

function DatedTab({ type, q }: { type: VehicleDocType; q: string }) {
  const { t } = useTranslation();
  const rows = useQuery({
    queryKey: ['fleet-docs', 'documents', type],
    queryFn: () => api.get<DocumentRow[]>(`/fleet-docs/documents/${type}`),
  });
  const shown = (rows.data ?? []).filter(
    (r) =>
      !q ||
      r.plate_number.toLowerCase().includes(q) ||
      (r.driver_name ?? '').toLowerCase().includes(q) ||
      (r.document?.holder_name ?? '').toLowerCase().includes(q),
  );
  if (rows.isLoading) return <Spinner />;
  if (shown.length === 0) return <EmptyState title={t('common.noResults')} hint={t('common.noResultsHint')} />;
  return (
    <div className="flex flex-col gap-3">
      {shown.map((row) => (
        <DatedCard key={`${type}-${row.vehicle_id}`} row={row} type={type} />
      ))}
    </div>
  );
}

function ymd(iso: string): string {
  return iso.slice(0, 10);
}
function dmy(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

/** Days until the paper runs out, and the colour that carries. */
function expiry(iso: string): { days: number; tone: string } {
  const days = daysUntil(iso);
  const tone =
    days < 0 ? 'bg-[#fdeaea] text-[#dc2626]' : days <= 30 ? 'bg-[#fef6e7] text-[#a15c07]' : 'bg-[#e6f6ec] text-[#15803d]';
  return { days, tone };
}

function DatedCard({ row, type }: { row: DocumentRow; type: VehicleDocType }) {
  const { t } = useTranslation();
  const doc = row.document;
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(doc ? ymd(doc.expires_at) : '');
  const [issued, setIssued] = useState(doc?.issued_at ? ymd(doc.issued_at) : '');
  const [number, setNumber] = useState(doc?.number ?? '');
  const [holder, setHolder] = useState(doc?.holder_name ?? '');
  const isPoa = type === 'power_of_attorney';
  // The advertising permit is two dates and a scan — no number, no holder:
  // the office only ever asks from when to when the lorry may carry it.
  const isAd = type === 'advertising_permit';

  // The seller's card reads expiry off the same rows, so the board is told too.
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['fleet-docs', 'documents', type] });
    void queryClient.invalidateQueries({ queryKey: ['vehicle', row.vehicle_id] });
    void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    void queryClient.invalidateQueries({ queryKey: ['seller-board'] });
  };
  const save = useMutation({
    mutationFn: () =>
      doc
        ? api.patch(`/vehicles/${row.vehicle_id}/documents/${doc.id}`, {
            expires_at: date,
            ...(isAd ? { issued_at: issued || null } : {}),
            number: isAd ? null : number.trim() || null,
            ...(isPoa ? { holder_name: holder.trim() || null } : {}),
          })
        : api.post(`/vehicles/${row.vehicle_id}/documents`, {
            type,
            expires_at: date,
            ...(isAd && issued ? { issued_at: issued } : {}),
            ...(!isAd && number.trim() ? { number: number.trim() } : {}),
            ...(isPoa && holder.trim() ? { holder_name: holder.trim() } : {}),
          }),
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/vehicles/${row.vehicle_id}/documents/${doc!.id}`),
    onSuccess: refresh,
  });

  const form = (
    <div className="flex flex-wrap items-end gap-2">
      {isAd && (
        <label className="text-xs text-slate">
          {t('documents.issued')}
          <input type="date" className="input mt-1" value={issued} onChange={(e) => setIssued(e.target.value)} />
        </label>
      )}
      <label className="text-xs text-slate">
        {t('documents.expires')}
        <input type="date" className="input mt-1" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      {!isAd && (
        <label className="text-xs text-slate">
          {t('documents.number')}
          <input className="input mt-1" value={number} onChange={(e) => setNumber(e.target.value)} />
        </label>
      )}
      {isPoa && (
        <label className="text-xs text-slate">
          {t('documents.holder')}
          <input
            className="input mt-1"
            value={holder}
            onChange={(e) => setHolder(e.target.value)}
            placeholder={t('documents.holderPlaceholder')}
          />
        </label>
      )}
      <button type="button" className="btn-primary" disabled={!date || save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? t('common.saving') : t('documents.save')}
      </button>
      <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>
        {t('common.cancel')}
      </button>
    </div>
  );

  const { days, tone } = doc ? expiry(doc.expires_at) : { days: 0, tone: '' };
  const expiryLabel =
    days < 0 ? t('documents.expiredLabel') : days === 0 ? t('documents.today') : t('documents.daysLeft', { n: days });

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <RowHead row={row} />
        {doc && !editing && (
          <div className="flex items-center gap-2">
            <ItemActions size="sm" onEdit={() => setEditing(true)} onDelete={() => remove.mutate()} />
          </div>
        )}
      </div>
      {editing ? (
        form
      ) : !doc ? (
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-light">{t('documents.none')}</span>
          <button type="button" className="btn-ghost" onClick={() => setEditing(true)}>
            + {t('documents.add')}
          </button>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <div className="space-y-1.5 text-sm">
            {isAd && doc.issued_at && (
              <div className="flex items-center gap-2">
                <span className="text-slate">{t('documents.issued')}:</span>
                <span className="font-mono font-medium text-ink">{dmy(doc.issued_at)}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-slate">{t('documents.expires')}:</span>
              <span className="font-mono font-medium text-ink">{dmy(doc.expires_at)}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{expiryLabel}</span>
            </div>
            {doc.number && (
              <div>
                <span className="text-slate">{t('documents.number')}:</span>{' '}
                <span className="font-mono text-ink">{doc.number}</span>
              </div>
            )}
            {isPoa && (
              <div>
                <span className="text-slate">{t('documents.holder')}:</span>{' '}
                <span className="font-medium text-ink">{doc.holder_name ?? '—'}</span>
              </div>
            )}
            {doc.notes && <div className="text-slate-light">{doc.notes}</div>}
          </div>
          <DocPhotoSlot
            label={t('documents.photo')}
            url={doc.photo_url}
            onUpload={(base64) => api.post(`/fleet-docs/documents/${doc.id}/photo`, { base64 }).then(refresh)}
            onClear={() => api.del(`/fleet-docs/documents/${doc.id}/photo`).then(refresh)}
          />
        </div>
      )}
    </Card>
  );
}
