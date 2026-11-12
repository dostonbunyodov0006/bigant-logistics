import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type {
  DriverPublic,
  IncidentPublic,
  KmRecordPublic,
  OrderPage,
  OrderStats,
  VehiclePublic,
} from '@bigant/shared';
import { MAX_PAGE_SIZE } from '@bigant/shared';
import { api } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { Card, ErrorNote, PageHeader, Spinner } from '../components/ui';
import { DateRangeFilter, Pager, inRange, localYmd } from '../components/Pager';
import { StatsStrip } from '../components/StatsStrip';
import { OrderList } from '../components/OrderList';
import { VehicleIncidentFormModal } from '../components/forms/VehicleIncidentFormModal';
import { VehicleFormModal } from '../components/forms/VehicleFormModal';
import { ItemActions } from '../components/ItemActions';
import { VehiclePapersCard } from '../components/VehiclePapersCard';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { formatDateTime } from '../lib/format';
import { TZ } from '../lib/tashkent';
import { safeHref } from '../lib/safeHref';

const STATUS_TONE: Record<VehiclePublic['status'], string> = {
  active: 'bg-[#e6f6ec] text-[#15803d]',
  maintenance: 'bg-[#fef6e7] text-[#a15c07]',
  inactive: 'bg-[#f0f1f3] text-[#8a93a0]',
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-mist/60 py-2 last:border-0">
      <span className="text-sm text-slate">{label}</span>
      <span className="text-sm text-ink">{value}</span>
    </div>
  );
}

/** Rows shown per page in the mileage / documents / incidents boxes. */
const PAGE = 4;
/** Orders shown per page in the related-orders list. */
const ORDERS_PAGE = 5;

export function VehicleDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const vehicleQ = useQuery({
    queryKey: ['vehicle', id],
    queryFn: () => api.get<VehiclePublic>(`/vehicles/${id}`),
  });
  const v = vehicleQ.data;
  const driverId = v?.assigned_driver_id ?? null;

  const statsQ = useQuery({
    queryKey: ['orders', 'stats', 'driver', driverId],
    queryFn: () => api.get<OrderStats>(`/orders/stats?driver_id=${driverId}`),
    enabled: !!driverId,
    // SSE keeps this live; the slow interval is only a reconnect/token-refresh safety net.
    refetchInterval: 60_000,
  });
  // Server-side paginated related orders (skip/take + total count).
  // Editing and removing the lorry sit here now, not on every row of the list.
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [orderPage, setOrderPage] = useState(0);
  const ordersQ = useQuery({
    queryKey: ['orders', 'page', 'driver', driverId, orderPage],
    queryFn: () =>
      api.get<OrderPage>(
        `/orders/page?driver_id=${driverId}&skip=${orderPage * ORDERS_PAGE}&take=${ORDERS_PAGE}`,
      ),
    enabled: !!driverId,
    // SSE keeps this live; the slow interval is only a reconnect/token-refresh safety net.
    refetchInterval: 60_000,
    // Keep the current page visible while the next one loads (no flicker).
    placeholderData: (prev) => prev,
  });

  const [kmInput, setKmInput] = useState('');
  const [kmAttempted, setKmAttempted] = useState(false);
  const kmQ = useQuery({
    queryKey: ['vehicle', id, 'km'],
    queryFn: () => api.get<KmRecordPublic[]>(`/vehicles/${id}/km`),
  });
  const addKmM = useMutation({
    mutationFn: (km: number) => api.post(`/vehicles/${id}/km`, { km }),
    onSuccess: () => {
      setKmInput('');
      setKmAttempted(false);
      void queryClient.invalidateQueries({ queryKey: ['vehicle', id] });
      void queryClient.invalidateQueries({ queryKey: ['vehicle', id, 'km'] });
    },
  });

  // The lorry is given its driver here. The roster is bounded like every
  // reference list; a fleet past this size wants a searchable picker.
  const driversQ = useQuery({
    queryKey: ['drivers', 'all'],
    queryFn: () => api.get<DriverPublic[]>(`/drivers?take=${MAX_PAGE_SIZE}`),
  });
  // Only the people a power of attorney in force names may drive this lorry.
  const authorizedQ = useQuery({
    queryKey: ['vehicle', id, 'authorized-drivers'],
    queryFn: () => api.get<{ has_poa: boolean; driver_ids: string[] }>(`/vehicles/${id}/authorized-drivers`),
  });
  const authorized = new Set(authorizedQ.data?.driver_ids ?? []);
  const assignDriverM = useMutation({
    mutationFn: async (driverId: string | null) => {
      // One driver per lorry: the current one is let go before the next is
      // put on, or the second write trips the unique constraint.
      if (v?.assigned_driver_id && v.assigned_driver_id !== driverId) {
        await api.patch(`/drivers/${v.assigned_driver_id}`, { vehicle_id: null });
      }
      if (driverId) await api.patch(`/drivers/${driverId}`, { vehicle_id: id });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vehicle', id] });
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      void queryClient.invalidateQueries({ queryKey: ['drivers'] });
      void queryClient.invalidateQueries({ queryKey: ['driver'] });
    },
  });

  const deleteVehicleM = useMutation({
    mutationFn: () => api.del(`/vehicles/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      navigate('/vehicles', { replace: true });
    },
  });

  const incidentsQ = useQuery({
    queryKey: ['vehicle', id, 'incidents'],
    queryFn: () => api.get<IncidentPublic[]>(`/vehicles/${id}/incidents`),
  });
  const [incidentFormOpen, setIncidentFormOpen] = useState(false);
  const [deletingIncident, setDeletingIncident] = useState<IncidentPublic | null>(null);
  const deleteIncidentM = useMutation({
    mutationFn: (incidentId: string) => api.del(`/vehicles/${id}/incidents/${incidentId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vehicle', id, 'incidents'] });
      setDeletingIncident(null);
    },
  });

  // Date-range filters + pagination for the mileage / documents / incidents boxes.
  const [kmFrom, setKmFrom] = useState('');
  const [kmTo, setKmTo] = useState('');
  const [kmPage, setKmPage] = useState(0);
  const [incFrom, setIncFrom] = useState('');
  const [incTo, setIncTo] = useState('');
  const [incPage, setIncPage] = useState(0);

  const kmAll = kmQ.data ?? [];
  const kmFiltered =
    kmFrom || kmTo ? kmAll.filter((r) => inRange(localYmd(r.recorded_at), kmFrom, kmTo)) : kmAll;
  const kmPages = Math.max(1, Math.ceil(kmFiltered.length / PAGE));
  const kmSafe = Math.min(kmPage, kmPages - 1);
  const kmRows = kmFiltered.slice(kmSafe * PAGE, kmSafe * PAGE + PAGE);


  const incAll = incidentsQ.data ?? [];
  const incFiltered =
    incFrom || incTo
      ? incAll.filter((i) => inRange(localYmd(i.occurred_at), incFrom, incTo))
      : incAll;
  const incPages = Math.max(1, Math.ceil(incFiltered.length / PAGE));
  const incSafe = Math.min(incPage, incPages - 1);
  const incRows = incFiltered.slice(incSafe * PAGE, incSafe * PAGE + PAGE);

  const orderItems = ordersQ.data?.items ?? [];
  const orderTotal = ordersQ.data?.total ?? 0;
  const orderPages = Math.max(1, Math.ceil(orderTotal / ORDERS_PAGE));

  if (vehicleQ.isLoading) return <Spinner />;

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate('/vehicles')}
        className="mb-3 text-sm font-medium text-slate hover:text-ink"
      >
        ← {t('common.back')}
      </button>

      <PageHeader
        title={v?.plate_number ?? '…'}
        subtitle={v?.model}
        actions={
          v ? (
            <div className="flex items-center gap-3">
              <ItemActions
                onEdit={() => setEditOpen(true)}
                onDelete={v.status !== 'inactive' ? () => setDeleteOpen(true) : undefined}
                deleteIcon="block"
                deleteLabel={t('vehicles.deleteTitle')}
              />
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[v.status]}`}>
                {t(`vehicleStatus.${v.status}`)}
              </span>
            </div>
          ) : undefined
        }
      />

      {v && <VehiclePapersCard vehicleId={id} />}

      {v && (
        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-light">
              {t('vehicleDetail.details')}
            </div>
            <Row label={t('vehicleForm.type')} value={t(`vehicleType.${v.type}`)} />
            <Row label={t('vehicleForm.techPassport')} value={v.tech_passport || '—'} />
            <Row label={t('vehicleForm.owner')} value={v.owner || '—'} />
            <Row label={t('vehicleForm.modelYear')} value={v.model_year != null ? String(v.model_year) : '—'} />
            <Row label={t('vehicleForm.capacity')} value={v.capacity_kg != null ? `${v.capacity_kg} kg` : '—'} />
            <Row
              label={t('vehicleForm.dimensions')}
              value={
                v.length_cm && v.width_cm && v.height_cm
                  ? `${v.length_cm} × ${v.width_cm} × ${v.height_cm} sm`
                  : '—'
              }
            />
            <Row label={t('vehicleForm.notes')} value={v.notes || '—'} />
          </Card>

          <Card className="p-4">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-light">
              {t('vehicleDetail.assignedDriver')}
            </div>
            <select
              className="input mb-2"
              value={v.assigned_driver_id ?? ''}
              disabled={assignDriverM.isPending}
              onChange={(e) => assignDriverM.mutate(e.target.value || null)}
            >
              <option value="">{t('vehicleDetail.noDriver')}</option>
              {/* Only the drivers this lorry's power of attorney names (and the
                  one on it now), with the lorry each holds now; choosing a man
                  here takes him off the first. */}
              {(driversQ.data ?? [])
                .filter((d) => authorized.has(d.id) || d.id === v.assigned_driver_id)
                .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.vehicle_plate && d.id !== v.assigned_driver_id ? ` — ${d.vehicle_plate}` : ''}
                </option>
              ))}
            </select>
            {authorizedQ.data && !authorizedQ.data.has_poa ? (
              <p className="mb-2 text-xs font-semibold text-[#b91c1c]">{t('vehicleDetail.noPoa')}</p>
            ) : (
              <p className="mb-2 text-xs text-slate-light">{t('vehicleDetail.poaOnly')}</p>
            )}
            {v.assigned_driver_id && (
              <div>
                <button
                  type="button"
                  onClick={() => navigate(`/drivers/${v.assigned_driver_id}`)}
                  className="font-medium text-brand hover:underline"
                >
                  {v.assigned_driver_name}
                </button>
                {v.assigned_driver_phone && (
                  <div className="mt-1 font-mono text-sm text-slate">
                    {v.assigned_driver_phone}
                  </div>
                )}
              </div>
            )}
            {assignDriverM.isError && (
              <div className="mt-3">
                <ErrorNote error={assignDriverM.error} />
              </div>
            )}
          </Card>
        </div>
      )}

      {v && (
        <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Card className="flex flex-col p-4">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-light">
            {t('vehicleDetail.mileage')}
          </div>
          <div className="mb-3 text-sm text-slate">
            {t('vehicleDetail.currentKm')}:{' '}
            <b className="font-mono text-ink">{v.current_km != null ? `${v.current_km} km` : '—'}</b>
          </div>
          <div className="mb-2 flex gap-2">
            <input
              id="vehicle-km-input"
              type="number"
              min="0"
              className={`input max-w-[180px] ${kmAttempted && (!kmInput || Number(kmInput) <= 0) ? 'border-[#dc2626]' : ''}`}
              placeholder="48500"
              value={kmInput}
              onChange={(e) => setKmInput(e.target.value)}
            />
            <button
              type="button"
              className="btn-primary"
              disabled={addKmM.isPending}
              onClick={() => {
                setKmAttempted(true);
                if (!kmInput || Number(kmInput) <= 0) {
                  document.getElementById('vehicle-km-input')?.focus();
                  return;
                }
                addKmM.mutate(Number(kmInput));
              }}
            >
              {t('vehicleDetail.addKm')}
            </button>
          </div>
          {kmAttempted && (!kmInput || Number(kmInput) <= 0) && (
            <p role="alert" className="mb-2 text-xs font-medium text-[#dc2626]">{t('common.requiredField')}</p>
          )}
          {addKmM.isError && <ErrorNote error={addKmM.error} />}
          <DateRangeFilter
            from={kmFrom}
            to={kmTo}
            onFrom={(val) => {
              setKmFrom(val);
              setKmPage(0);
            }}
            onTo={(val) => {
              setKmTo(val);
              setKmPage(0);
            }}
            onClear={() => {
              setKmFrom('');
              setKmTo('');
              setKmPage(0);
            }}
            clearLabel={t('common.clearFilters')}
          />
          <div className="flex-1 divide-y divide-mist/60">
            {kmFiltered.length === 0 ? (
              <div className="py-2 text-sm text-slate-light">{t('vehicleDetail.noKm')}</div>
            ) : (
              kmRows.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="font-mono text-ink">{r.km} km</span>
                  {/* The driver's weekly odometer photo, when the reading came with one. */}
                  {r.photo_url ? (
                    <a href={safeHref(r.photo_url)} target="_blank" rel="noreferrer" className="shrink-0">
                      <img src={r.photo_url} alt="" className="h-10 w-14 rounded object-cover" />
                    </a>
                  ) : null}
                  <span className="ml-auto text-slate">{formatDateTime(r.recorded_at)}</span>
                </div>
              ))
            )}
          </div>
          <Pager page={kmSafe} count={kmPages} onPage={setKmPage} />
        </Card>

          <Card className="flex flex-col p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-light">
              {t('vehicleDetail.incidents')}
            </span>
            <button
              type="button"
              className="text-sm font-medium text-brand hover:underline"
              onClick={() => setIncidentFormOpen(true)}
            >
              + {t('vehicleDetail.addIncident')}
            </button>
          </div>
          <DateRangeFilter
            from={incFrom}
            to={incTo}
            onFrom={(val) => {
              setIncFrom(val);
              setIncPage(0);
            }}
            onTo={(val) => {
              setIncTo(val);
              setIncPage(0);
            }}
            onClear={() => {
              setIncFrom('');
              setIncTo('');
              setIncPage(0);
            }}
            clearLabel={t('common.clearFilters')}
          />
          {incFiltered.length === 0 ? (
            <div className="flex-1 py-2 text-sm text-slate-light">{t('vehicleDetail.noIncidents')}</div>
          ) : (
            <div className="flex-1 divide-y divide-mist/60">
              {incRows.map((inc) => (
                <div key={inc.id} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <div className="text-sm font-medium text-ink">
                      {t(`incidentType.${inc.type}`)}
                      {inc.client_name ? (
                        <span className="ml-2 text-xs text-slate">{inc.client_name}</span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-xs text-slate">
                      {new Date(inc.occurred_at).toLocaleDateString(undefined, { timeZone: TZ })}
                      {inc.description ? ` · ${inc.description}` : ''}
                    </div>
                  </div>
                  <ItemActions size="sm" onDelete={() => setDeletingIncident(inc)} />
                </div>
              ))}
            </div>
          )}
          <Pager page={incSafe} count={incPages} onPage={setIncPage} />
          </Card>
        </div>
      )}

      {driverId && (
        <>
          <div className="mb-6">
            <StatsStrip stats={statsQ.data} />
          </div>
          <h2 className="mb-3 font-display text-lg font-semibold">{t('orders.title')}</h2>
          {ordersQ.isLoading ? (
            <Spinner />
          ) : (
            <>
              <OrderList orders={orderItems} emptyTitle={t('orders.noMatch')} />
              <Pager page={orderPage} count={orderPages} onPage={setOrderPage} size="lg" />
            </>
          )}
        </>
      )}


      <VehicleIncidentFormModal
        open={incidentFormOpen}
        vehicleId={id}
        onClose={() => setIncidentFormOpen(false)}
      />
      <ConfirmDialog
        open={!!deletingIncident}
        title={t('vehicleDetail.deleteIncidentTitle')}
        message={t('vehicleDetail.deleteIncidentMessage')}
        pending={deleteIncidentM.isPending}
        error={deleteIncidentM.isError ? deleteIncidentM.error : undefined}
        onClose={() => setDeletingIncident(null)}
        onConfirm={() => deletingIncident && deleteIncidentM.mutate(deletingIncident.id)}
      />

      <VehicleFormModal open={editOpen} editing={v ?? null} onClose={() => setEditOpen(false)} />
      <ConfirmDialog
        open={deleteOpen}
        title={t('vehicles.deleteTitle')}
        message={t('vehicles.deleteMessage', { plate: v?.plate_number ?? '' })}
        pending={deleteVehicleM.isPending}
        error={deleteVehicleM.isError ? deleteVehicleM.error : undefined}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => deleteVehicleM.mutate()}
      />
    </div>
  );
}
