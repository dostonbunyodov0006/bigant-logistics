import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  VOZVRAT_CULPRITS,
  VOZVRAT_REASONS,
  type DriverPublic,
  type OrderPublic,
  type ReturnDestination,
  type VozvratCulprit,
  type VozvratListPage,
  type VozvratListRow,
} from '@bigant/shared';
import { api } from '../lib/api';
import { SupplierPlacePicker } from '../components/SupplierPlacePicker';
import { Card, EmptyState, ErrorNote, PageHeader, Spinner } from '../components/ui';
import { queryClient } from '../lib/queryClient';
import { Pager } from '../components/Pager';
import { StatusBadge } from '../components/StatusBadge';
import { TZ, tkMonthStart, tkYmd } from '../lib/tashkent';
import { safeHref } from '../lib/safeHref';

const PAGE = 20;

function ymd(d: Date): string {
  return tkYmd(d);
}
const when = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const reasonText = (code: string) => VOZVRAT_REASONS.find((r) => r.code === code)?.text ?? code;

const CULPRIT_TONE: Record<VozvratCulprit, string> = {
  sotuvchi: 'bg-amber-100 text-amber-800',
  mijoz: 'bg-blue-100 text-blue-800',
  omborchi: 'bg-purple-100 text-purple-800',
  haydovchi: 'bg-red-100 text-red-800',
};
const REPORT_TONE = {
  // Written up, but the seller has not checked it yet — nothing has been
  // offered to the mini app at all.
  held: 'bg-mist text-slate',
  pending: 'bg-amber-100 text-amber-800',
  sent: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
} as const;

/** Every vozvrat the drivers wrote up: what came back and who is to blame. */
/** `embedded`: shown as a tab of Buyurtmalar, which carries the heading. */
export function VozvratPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useTranslation();
  const now = new Date();
  const [from, setFrom] = useState(tkMonthStart());
  const [to, setTo] = useState(ymd(now));
  const [driverId, setDriverId] = useState('');
  const [culprit, setCulprit] = useState<'' | VozvratCulprit>('');
  const [page, setPage] = useState(0);

  const drivers = useQuery({ queryKey: ['drivers', 'all'], queryFn: () => api.get<DriverPublic[]>('/drivers') });
  const qs = [
    from && `from=${from}`,
    to && `to=${to}`,
    driverId && `driver_id=${driverId}`,
    culprit && `culprit=${culprit}`,
    `skip=${page * PAGE}`,
    `take=${PAGE}`,
  ]
    .filter(Boolean)
    .join('&');
  const { data, isLoading } = useQuery({
    queryKey: ['analytics', 'vozvrat', qs],
    queryFn: () => api.get<VozvratListPage>(`/analytics/vozvrat?${qs}`),
  });

  const filter = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(0);
  };
  const culpritLabel = (c: VozvratCulprit | null) => (c ? t(`vozvratAdmin.culprit_${c}`) : t('vozvratAdmin.culprit_none'));
  const summary = data?.summary;
  const top = summary?.by_culprit[0];
  const tiles = [
    { label: t('vozvratAdmin.returns'), value: String(summary?.returns ?? 0), fg: '#b94e06' },
    { label: t('vozvratAdmin.items'), value: String(summary?.items ?? 0), fg: '#14181f' },
    { label: t('vozvratAdmin.topCulprit'), value: top ? culpritLabel(top.culprit) : '—', fg: '#b91c1c' },
    { label: t('vozvratAdmin.drivers'), value: String(summary?.by_driver.length ?? 0), fg: '#5b6470' },
  ];
  const hasRows = !!data && data.items.length > 0;
  const pageCount = data ? Math.ceil(data.total / PAGE) : 0;

  return (
    <div>
      {!embedded && (
        <PageHeader
          title={t('vozvratAdmin.title')}
          actions={
            <Link to="/orders/new-vozvrat" className="btn-primary">
              {t('vozvratAdmin.newOrder')}
            </Link>
          }
        />
      )}

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="field-label" htmlFor="vz-from">{t('vozvratAdmin.from')}</label>
            <input id="vz-from" type="date" className="input" value={from} max={to} onChange={(e) => filter(setFrom)(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="vz-to">{t('vozvratAdmin.to')}</label>
            <input id="vz-to" type="date" className="input" value={to} min={from} onChange={(e) => filter(setTo)(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="vz-driver">{t('vozvratAdmin.driver')}</label>
            <select id="vz-driver" className="input" value={driverId} onChange={(e) => filter(setDriverId)(e.target.value)}>
              <option value="">{t('vozvratAdmin.allDrivers')}</option>
              {(drivers.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="vz-culprit">{t('vozvratAdmin.culprit')}</label>
            <select id="vz-culprit" className="input" value={culprit} onChange={(e) => filter(setCulprit)(e.target.value as '' | VozvratCulprit)}>
              <option value="">{t('vozvratAdmin.allCulprits')}</option>
              {VOZVRAT_CULPRITS.map((c) => (
                <option key={c} value={c}>{t(`vozvratAdmin.culprit_${c}`)}</option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {isLoading ? (
        <Card><Spinner /></Card>
      ) : !hasRows ? (
        <Card><EmptyState title={t('vozvratAdmin.noData')} hint={t('vozvratAdmin.noDataHint')} /></Card>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {tiles.map((tile) => (
              <Card key={tile.label} className="p-5">
                <div className="font-mono text-2xl font-semibold" style={{ color: tile.fg }}>{tile.value}</div>
                <div className="mt-1 text-sm text-slate">{tile.label}</div>
              </Card>
            ))}
          </div>

          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <h2 className="mb-3 font-display text-base font-semibold">{t('vozvratAdmin.byCulprit')}</h2>
              <div className="flex flex-wrap gap-2">
                {summary!.by_culprit.map((c) => (
                  <span key={c.culprit ?? 'none'} className={`rounded-full px-3 py-1 text-sm font-medium ${c.culprit ? CULPRIT_TONE[c.culprit] : 'bg-mist text-slate'}`}>
                    {culpritLabel(c.culprit)} · {c.items}
                  </span>
                ))}
              </div>
            </Card>
            <Card className="p-4">
              <h2 className="mb-3 font-display text-base font-semibold">{t('vozvratAdmin.byDriver')}</h2>
              <div className="divide-y divide-mist/60">
                {summary!.by_driver.map((d) => (
                  <div key={d.driver_id ?? 'none'} className="flex items-center justify-between py-2 text-sm">
                    {d.driver_id ? (
                      <Link to={`/drivers/${d.driver_id}`} className="font-medium text-ink hover:underline">{d.driver_name}</Link>
                    ) : (
                      <span className="text-slate">—</span>
                    )}
                    <span className="font-mono text-slate">
                      {t('vozvratAdmin.returnsN', { n: d.returns })} · {t('vozvratAdmin.itemsN', { n: d.items })}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="space-y-3">
            {data.items.map((row) => (
              <ReturnCard key={row.order_id} row={row} culpritLabel={culpritLabel} />
            ))}
          </div>
          <div className="mt-4">
            <Pager page={page} count={pageCount} onPage={setPage} size="lg" />
          </div>
        </>
      )}
    </div>
  );
}

function ReturnCard({ row, culpritLabel }: { row: VozvratListRow; culpritLabel: (c: VozvratCulprit | null) => string }) {
  const { t } = useTranslation();
  // The seller normally confirms this on his board; the office can answer for
  // him when the seller does not. Where the goods go back to is part of the
  // answer — Sklad, Do'kon or Ta'minotchi for each stop — as on the seller's
  // page, and the driver is sent there (owner, 30.10.2026).
  const [choosing, setChoosing] = useState(false);
  const [places, setPlaces] = useState<Record<string, ReturnDestination>>({});
  // Ta'minotchi: which supplier's place (owner, 12.11.2026).
  const [placeIds, setPlaceIds] = useState<Record<string, string>>({});
  const placeIdOf = (src: { id: string; pickup_place_id: string; return_place?: { place_id?: string | null } | null }) =>
    placeIds[src.id] ?? src.return_place?.place_id ?? src.pickup_place_id;
  const orderQ = useQuery({
    queryKey: ['order', row.order_id],
    queryFn: () => api.get<OrderPublic>(`/orders/${row.order_id}`),
    enabled: choosing,
  });
  const returning = (orderQ.data?.pickup_sources ?? []).filter((src) => src.return_required);
  const placeOf = (src: { id: string; return_destination: ReturnDestination | null }) =>
    places[src.id] ?? src.return_destination ?? null;
  const allChosen = returning.length > 0 && returning.every((src) => !!placeOf(src));
  const confirmM = useMutation({
    mutationFn: () =>
      api.patch(`/orders/${row.order_id}/return/items/confirm`, {
        destinations: returning.map((src) => ({
          pickup_source_id: src.id,
          destination: placeOf(src)!,
          ...(placeOf(src) === 'supplier' && placeIdOf(src) ? { place_id: placeIdOf(src) } : {}),
        })),
      }),
    onSuccess: () => {
      setChoosing(false);
      void queryClient.invalidateQueries({ queryKey: ['analytics', 'vozvrat'] });
      void queryClient.invalidateQueries({ queryKey: ['order', row.order_id] });
    },
  });
  // (owner, 07.11.2026) One row per place it is taken in at (warehouse and/or
  // shop); a supplier-only return has none and is done once it is sent.
  const ws = row.warehouses;
  const reportKey =
    ws.length > 0 && ws.every((w) => w.accepted_at)
      ? 'accepted'
      : row.report_status === 'sent' && ws.length === 0
        ? 'direct'
        : (row.report_status ?? 'none');
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-mist/60 px-4 py-3 text-sm">
        <Link to={`/orders/${row.order_id}`} className="font-semibold text-ink hover:underline">{row.client_name}</Link>
        <span className="text-slate">{when(row.returned_at)}</span>
        <StatusBadge status={row.order_status} />
        <span className="text-ink">
          {t('vozvratAdmin.driverLabel')}:{' '}
          {row.driver_id ? <Link to={`/drivers/${row.driver_id}`} className="font-medium hover:underline">{row.driver_name}</Link> : '—'}
        </span>
        <span className="text-slate">{t('vozvratAdmin.client')}: <span className="text-ink">{row.client_name}</span></span>
        <span className="text-slate">{t('vozvratAdmin.seller')}: <span className="text-ink">{row.seller_name}</span></span>
        {row.destination ? (
          <span className="text-slate">{t('vozvratAdmin.destination')}: <span className="text-ink">{t(`vozvratAdmin.dest_${row.destination as 'warehouse' | 'store' | 'supplier'}`)}</span></span>
        ) : null}
        <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-semibold ${row.report_status ? REPORT_TONE[row.report_status] : 'bg-mist text-slate'}`}>
          {t('vozvratAdmin.report')}: {t(`vozvratAdmin.report_${reportKey}`)}
        </span>
        {row.report_status === 'held' && (
          <button
            type="button"
            className="btn-ghost py-1 text-xs"
            disabled={confirmM.isPending}
            onClick={() => setChoosing((v) => !v)}
          >
            {t('vozvratAdmin.confirmForSeller')}
          </button>
        )}
      </div>
      {choosing && (
        <div className="border-b border-mist/60 bg-paper px-4 py-3">
          <div className="mb-2 text-sm font-semibold text-ink">{t('vozvratAdmin.whereBack')}</div>
          {orderQ.isLoading ? (
            <Spinner />
          ) : (
            returning.map((src) => (
              <div key={src.id} className="mb-2 last:mb-0">
                {returning.length > 1 && <div className="mb-1 text-xs text-slate">{src.name}</div>}
                <div className="flex flex-wrap gap-2">
                  {(['warehouse', 'store', 'supplier'] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setPlaces((cur) => ({ ...cur, [src.id]: d }))}
                      className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${
                        placeOf(src) === d
                          ? 'border-brand bg-brand text-white'
                          : 'border-mist bg-white text-ink hover:border-brand hover:text-brand-dark'
                      }`}
                    >
                      {t(`vozvratAdmin.dest_${d}`)}
                    </button>
                  ))}
                </div>
                {placeOf(src) === 'supplier' && (
                  <SupplierPlacePicker
                    tone="light"
                    value={placeIdOf(src)}
                    onPick={(id) => setPlaceIds((cur) => ({ ...cur, [src.id]: id }))}
                  />
                )}
              </div>
            ))
          )}
          <button
            type="button"
            className="btn-primary mt-3"
            disabled={!allChosen || confirmM.isPending}
            onClick={() => confirmM.mutate()}
          >
            {t('vozvratAdmin.confirm')}
          </button>
          {confirmM.isError && <ErrorNote error={confirmM.error} />}
        </div>
      )}
      <div className="divide-y divide-mist/60">
        {row.items.map((it) => (
          <div key={it.id} className="flex items-center gap-4 px-4 py-3 text-sm">
            <a href={safeHref(it.photo_url)} target="_blank" rel="noreferrer" className="shrink-0">
              <img src={it.photo_url} alt="" className="h-14 w-14 rounded-md object-cover" />
            </a>
            <div className="min-w-0 flex-1">
              <div className="font-medium text-ink">
                {it.name} <span className="font-mono text-slate">· {it.quantity} {it.unit ?? ''}</span>
              </div>
              <div className="text-slate">
                {it.reason === 'x' ? it.other_reason : reasonText(it.reason)}
              </div>
            </div>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${it.condition === 'yaroqli' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
              {t(`vozvratAdmin.cond_${it.condition}`)}
            </span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${it.culprit ? CULPRIT_TONE[it.culprit] : 'bg-mist text-slate'}`}>
              {culpritLabel(it.culprit)}
            </span>
          </div>
        ))}
      </div>
      {row.comment ? <div className="border-t border-mist/60 px-4 py-2 text-sm text-slate">{t('vozvratAdmin.comment')}: {row.comment}</div> : null}
      {ws.map((w) =>
        w.accepted_at ? <WarehouseCount key={w.id} w={w} culpritLabel={culpritLabel} /> : <WaitingIntake key={w.id} w={w} />,
      )}
    </Card>
  );
}

type Intake = VozvratListRow['warehouses'][number];

/**
 * Not taken in yet at the warehouse / shop (owner, 07.11.2026). The office
 * (admin, dispatcher) may mark it taken in when the storekeeper or the shop
 * person cannot: no count, no photos — it only frees the driver's "Topshirdim".
 */
function WaitingIntake({ w }: { w: Intake }) {
  const { t } = useTranslation();
  const releaseM = useMutation({
    mutationFn: () => api.post(`/ombor/returns/${w.id}/release`, {}),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['analytics', 'vozvrat'] }),
  });
  return (
    <div className="border-t border-mist/60 bg-amber-50 px-4 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="font-semibold text-amber-800">{t(`vozvratAdmin.waitingAt_${w.destination}`)}</span>
        <button
          type="button"
          className="btn-ghost ml-auto py-1 text-xs"
          disabled={releaseM.isPending}
          onClick={() => {
            if (window.confirm(t('vozvratAdmin.releaseConfirm', { place: t(`vozvratAdmin.place_${w.destination}`) }))) releaseM.mutate();
          }}
        >
          {t('vozvratAdmin.release')}
        </button>
      </div>
      {releaseM.isError && <ErrorNote error={releaseM.error} />}
    </div>
  );
}

/** The storekeeper's (or the shop's) count from the warehouse page (owner, 05.11.2026). */
function WarehouseCount({
  w,
  culpritLabel,
}: {
  w: Intake;
  culpritLabel: (c: VozvratCulprit | null) => string;
}) {
  const { t } = useTranslation();
  const thumb = (url: string | null) =>
    url ? (
      <a href={safeHref(url)} target="_blank" rel="noreferrer" className="shrink-0">
        <img src={url} alt="" className="h-14 w-14 rounded-md object-cover" />
      </a>
    ) : null;
  return (
    <div className="border-t-2 border-brand/40 bg-brand/5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm">
        <span className="font-semibold text-ink">{t(w.destination === 'store' ? 'vozvratAdmin.storeBy' : 'vozvratAdmin.warehouseBy')}</span>
        <span className="text-ink">{w.accepted_by ?? '—'}</span>
        <span className="text-slate">{when(w.accepted_at!)}</span>
      </div>
      <div className="divide-y divide-mist/60">
        {w.items.map((it, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3 text-sm">
            {thumb(it.photo_url)}
            {thumb(it.damage_photo_url)}
            <div className="min-w-0 flex-1">
              <div className="font-medium text-ink">
                {it.name} <span className="font-mono text-slate">· {it.quantity}</span>
              </div>
              <div className="text-slate">{it.reason === 'x' ? it.other_reason : reasonText(it.reason)}</div>
            </div>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${it.condition === 'yaroqli' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
              {t(`vozvratAdmin.cond_${it.condition}`)}
            </span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${it.culprit ? CULPRIT_TONE[it.culprit] : 'bg-mist text-slate'}`}>
              {culpritLabel(it.culprit)}
            </span>
          </div>
        ))}
      </div>
      {w.overall_photo_url || w.comment ? (
        <div className="flex items-center gap-4 border-t border-mist/60 px-4 py-3 text-sm">
          {thumb(w.overall_photo_url)}
          {w.overall_photo_url ? <span className="text-slate">{t('vozvratAdmin.warehouseAll')}</span> : null}
          {w.comment ? <span className="text-slate">{t('vozvratAdmin.comment')}: <span className="text-ink">{w.comment}</span></span> : null}
        </div>
      ) : null}
    </div>
  );
}
