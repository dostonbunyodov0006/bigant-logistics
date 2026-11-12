import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type {
  DriverDocumentPublic,
  DriverPublic,
  OrderPage,
  OrderStats,
  WorkLogPublic,
} from '@bigant/shared';
import { api } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { Card, PageHeader, Spinner } from '../components/ui';
import { WorkScheduleEditor } from '../components/WorkScheduleEditor';
import { DateRangeFilter, Pager, inRange, localYmd } from '../components/Pager';
import { DriverStatusBadge } from '../components/StatusBadge';
import { StatsStrip } from '../components/StatsStrip';
import { OrderList } from '../components/OrderList';
import { DriverDocumentFormModal } from '../components/forms/DriverDocumentFormModal';
import { DriverFormModal } from '../components/forms/DriverFormModal';
import { ItemActions } from '../components/ItemActions';
import { DocPhotoSlot } from '../components/DocPhotoSlot';
import { VehiclePapersCard } from '../components/VehiclePapersCard';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { isKnownCloseSource, useCarryReason } from '../components/ShiftCheck';
import { WorkLogCorrectModal } from '../components/forms/WorkLogCorrectModal';
import { useAuth } from '../auth/AuthContext';
import { TZ, daysUntil } from '../lib/tashkent';

function expiryStatus(expiresAtIso: string): 'expired' | 'soon' | 'ok' {
  const days = daysUntil(expiresAtIso);
  if (days < 0) return 'expired';
  if (days <= 30) return 'soon';
  return 'ok';
}
const EXPIRY_TONE: Record<'expired' | 'soon' | 'ok', string> = {
  expired: 'bg-[#fdeaea] text-[#dc2626]',
  soon: 'bg-[#fef6e7] text-[#a15c07]',
  ok: 'bg-[#e6f6ec] text-[#15803d]',
};

/** Rows per page for the documents / work-shifts boxes. */
const PAGE = 4;
/** Orders per page in the related-orders list. */
const ORDERS_PAGE = 5;

function dmy(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between border-b border-mist/60 py-2 last:border-0 sm:border-0">
      <span className="text-sm text-slate">{label}</span>
      <span className="text-sm font-medium text-ink">{value || '—'}</span>
    </div>
  );
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
}

export function DriverDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const carryWhy = useCarryReason();
  const { user } = useAuth();
  // Correcting a shift is admin-only on the server too.
  // The server lets a manager do this; see roles.guard.ts.
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';
  const [fixing, setFixing] = useState<WorkLogPublic | null>(null);
  // Editing and deleting the driver moved here off the list, where a stray tap
  // landed on the row below.
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const driverQ = useQuery({
    queryKey: ['driver', id],
    queryFn: () => api.get<DriverPublic>(`/drivers/${id}`),
  });
  const statsQ = useQuery({
    queryKey: ['orders', 'stats', 'driver', id],
    queryFn: () => api.get<OrderStats>(`/orders/stats?driver_id=${id}`),
    // SSE keeps this live; the slow interval is only a reconnect/token-refresh safety net.
    refetchInterval: 60_000,
  });
  const [orderPage, setOrderPage] = useState(0);
  const ordersQ = useQuery({
    queryKey: ['orders', 'page', 'driver', id, orderPage],
    queryFn: () =>
      api.get<OrderPage>(
        `/orders/page?driver_id=${id}&skip=${orderPage * ORDERS_PAGE}&take=${ORDERS_PAGE}`,
      ),
    // SSE keeps this live; the slow interval is only a reconnect/token-refresh safety net.
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });

  // Both sides of the driving licence, beside the lorry's papers.
  const refreshDriver = () => {
    void queryClient.invalidateQueries({ queryKey: ['driver', id] });
    void queryClient.invalidateQueries({ queryKey: ['fleet-docs'] });
    void queryClient.invalidateQueries({ queryKey: ['seller', 'tech-passports'] });
  };
  const setDoc = (kind: 'license_front' | 'license_back') => (base64: string) =>
    api.post(`/fleet-docs/drivers/${id}/${kind}`, { base64 }).then(refreshDriver);
  const clearDoc = (kind: 'license_front' | 'license_back') => () =>
    api.del(`/fleet-docs/drivers/${id}/${kind}`).then(refreshDriver);

  const deleteM = useMutation({
    mutationFn: () => api.del(`/drivers/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['drivers'] });
      navigate('/drivers', { replace: true });
    },
  });

  const docsQ = useQuery({
    queryKey: ['driver', id, 'documents'],
    queryFn: () => api.get<DriverDocumentPublic[]>(`/drivers/${id}/documents`),
  });
  const shiftsQ = useQuery({
    queryKey: ['driver', id, 'work-logs'],
    queryFn: () => api.get<WorkLogPublic[]>(`/drivers/${id}/work-logs`),
    refetchInterval: 30_000,
  });
  const [docFormOpen, setDocFormOpen] = useState(false);
  const [editingDoc, setEditingDoc] = useState<DriverDocumentPublic | null>(null);
  const [deletingDoc, setDeletingDoc] = useState<DriverDocumentPublic | null>(null);
  const deleteDocM = useMutation({
    mutationFn: (docId: string) => api.del(`/drivers/${id}/documents/${docId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['driver', id, 'documents'] });
      void queryClient.invalidateQueries({ queryKey: ['driver', id] });
      setDeletingDoc(null);
    },
  });

  const driver = driverQ.data;

  // Pagination for documents; date-range + pagination for work shifts.
  const [docPage, setDocPage] = useState(0);
  const [shiftFrom, setShiftFrom] = useState('');
  const [shiftTo, setShiftTo] = useState('');
  const [shiftPage, setShiftPage] = useState(0);

  const docsAll = docsQ.data ?? [];
  const docPages = Math.max(1, Math.ceil(docsAll.length / PAGE));
  const docSafe = Math.min(docPage, docPages - 1);
  const docRows = docsAll.slice(docSafe * PAGE, docSafe * PAGE + PAGE);

  const shiftsAll = shiftsQ.data ?? [];
  const shiftsFiltered =
    shiftFrom || shiftTo
      ? shiftsAll.filter((w) => inRange(localYmd(w.clock_in_at), shiftFrom, shiftTo))
      : shiftsAll;
  const shiftPages = Math.max(1, Math.ceil(shiftsFiltered.length / PAGE));
  const shiftSafe = Math.min(shiftPage, shiftPages - 1);
  const shiftRows = shiftsFiltered.slice(shiftSafe * PAGE, shiftSafe * PAGE + PAGE);

  const orderItems = ordersQ.data?.items ?? [];
  const orderTotal = ordersQ.data?.total ?? 0;
  const orderPages = Math.max(1, Math.ceil(orderTotal / ORDERS_PAGE));

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate('/drivers')}
        className="mb-3 text-sm font-medium text-slate hover:text-ink"
      >
        ← {t('common.back')}
      </button>

      <PageHeader
        title={driver?.name ?? '…'}
        subtitle={driver?.phone_number}
        actions={
          driver ? (
            <div className="flex items-center gap-3">
              {isAdmin && (
                <ItemActions onEdit={() => setEditOpen(true)} onDelete={() => setDeleteOpen(true)} />
              )}
              <Link to={`/track?driver=${driver.id}`} className="btn-ghost">
                {t('driverDetail.routeHistory')}
              </Link>
              <DriverStatusBadge status={driver.current_status} />
            </div>
          ) : undefined
        }
      />

      {driver && (
        <Card className="mb-6 p-4">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-light">
            {t('driverDetail.profile')}
          </div>
          {/* These three could be set in the form and read back nowhere, and
              the licence category is the one that turns the seller's card red. */}
          <div className="grid gap-x-8 sm:grid-cols-3">
            <DetailRow label={t('driverForm.licenseCategory')} value={driver.license_category} />
            <DetailRow
              label={t('driverDetail.staj')}
              value={driver.license_years != null ? t('driverDetail.years', { n: driver.license_years }) : null}
            />
            <DetailRow label={t('driverForm.licenseExpires')} value={driver.license_expires_at ? dmy(driver.license_expires_at) : null} />
            <DetailRow label={t('driverForm.birthDate')} value={driver.birth_date} />
            <DetailRow label={t('driverForm.homeDistrict')} value={driver.home_district_name} />
          </div>
          {/* Which lorry is his is decided on the lorry's page — a vehicle is
              given a driver, not the other way round — and only read here. */}
          <div className="mt-2 flex items-center gap-2 border-t border-mist/60 pt-2 text-sm">
            <span className="text-slate">{t('driverDetail.vehicle')}:</span>
            {driver.vehicle_id ? (
              <Link to={`/vehicles/${driver.vehicle_id}`} className="font-medium text-brand hover:underline">
                {driver.vehicle_plate} · {driver.vehicle_model}
              </Link>
            ) : (
              <span className="text-slate-light">{t('driverDetail.noVehicle')}</span>
            )}
          </div>
        </Card>
      )}

      {driver && (
        <Card className="mb-6 p-4">
          <div className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-light">
            {t('driverDetail.licensePhotos')}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <DocPhotoSlot label={t('docPhoto.front')} url={driver.license_front_url} onUpload={setDoc('license_front')} onClear={clearDoc('license_front')} />
            <DocPhotoSlot label={t('docPhoto.back')} url={driver.license_back_url} onUpload={setDoc('license_back')} onClear={clearDoc('license_back')} />
          </div>
        </Card>
      )}

      {/* His lorry's papers, the same rows the lorry's page and Hujjatlar
          show — one copy, so nothing here can disagree with them. */}
      {driver?.vehicle_id && <VehiclePapersCard vehicleId={driver.vehicle_id} />}

      {driver && (
        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          <Card className="flex flex-col p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-light">
                {t('driverDetail.documents')}
              </span>
              <button
                type="button"
                className="text-sm font-medium text-brand hover:underline"
                onClick={() => {
                  setEditingDoc(null);
                  setDocFormOpen(true);
                }}
              >
                + {t('driverDetail.addDocument')}
              </button>
            </div>
            {docsAll.length === 0 ? (
              <div className="flex-1 py-2 text-sm text-slate-light">{t('driverDetail.noDocs')}</div>
            ) : (
              <div className="flex-1 divide-y divide-mist/60">
                {docRows.map((d) => {
                  const status = expiryStatus(d.expires_at);
                  return (
                    <div key={d.id} className="flex items-center justify-between gap-3 py-2">
                      <div>
                        <div className="text-sm font-medium text-ink">
                          {t(`driverDocType.${d.type}`)}
                          {d.number ? (
                            <span className="ml-2 font-mono text-xs text-slate">{d.number}</span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-xs">
                          <span className="text-slate">
                            {t('driverDetail.expires')}:{' '}
                            {new Date(d.expires_at).toLocaleDateString(undefined, { timeZone: TZ })}
                          </span>
                          {status !== 'ok' && (
                            <span
                              className={`rounded-full px-2 py-0.5 font-medium ${EXPIRY_TONE[status]}`}
                            >
                              {status === 'expired'
                                ? t('driverDetail.expired')
                                : t('driverDetail.expiringSoon')}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-3 text-sm">
                        <ItemActions
                          size="sm"
                          onEdit={() => {
                            setEditingDoc(d);
                            setDocFormOpen(true);
                          }}
                          onDelete={() => setDeletingDoc(d)}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <Pager page={docSafe} count={docPages} onPage={setDocPage} />
          </Card>

          <Card className="flex flex-col p-4">
            <div className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-light">
              {t('driverDetail.workShifts')}
            </div>
            <DateRangeFilter
              from={shiftFrom}
              to={shiftTo}
              onFrom={(val) => {
                setShiftFrom(val);
                setShiftPage(0);
              }}
              onTo={(val) => {
                setShiftTo(val);
                setShiftPage(0);
              }}
              onClear={() => {
                setShiftFrom('');
                setShiftTo('');
                setShiftPage(0);
              }}
              clearLabel={t('common.clearFilters')}
            />
            {shiftsFiltered.length === 0 ? (
              <div className="flex-1 py-2 text-sm text-slate-light">
                {t('driverDetail.noShifts')}
              </div>
            ) : (
              <div className="flex-1 divide-y divide-mist/60">
                {shiftRows.map((w) => (
                  <div key={w.id} className="flex items-center justify-between gap-3 py-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-ink">
                        {new Date(w.clock_in_at).toLocaleDateString(undefined, { timeZone: TZ })}
                        {w.auto_closed && (
                          <span className="rounded-full bg-[#fdeaea] px-2 py-0.5 text-[11px] font-semibold text-[#dc2626]">
                            {t('shiftCheck.autoClosed')}
                          </span>
                        )}
                        {w.day_off && (
                          <span className="rounded-full bg-[#fdecec] px-2 py-0.5 text-[11px] font-semibold text-[#b91c1c]">
                            {t('breaksLog.dayOff')}
                          </span>
                        )}
                        {w.end_check_zone === 'viloyat' && (
                          <span className="rounded-full bg-[#eaf1fd] px-2 py-0.5 text-[11px] font-semibold text-[#1d4ed8]">
                            {t('shiftCheck.viloyat')}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 font-mono text-xs text-slate">
                        {timeOf(w.clock_in_at)} – {w.clock_out_at ? timeOf(w.clock_out_at) : '…'}
                      </div>
                      {w.late_reason && (
                        <div className="mt-1 text-xs text-[#a15c07]">
                          {t('driverDetail.late')}: {w.late_reason}
                        </div>
                      )}
                      {w.early_leave_reason && (
                        <div className="mt-1 text-xs text-[#a15c07]">
                          {t('driverDetail.earlyLeave')}: {w.early_leave_reason}
                        </div>
                      )}
                      {isKnownCloseSource(w.close_source) && (
                        <div className="mt-1 text-xs text-slate">
                          {t(`shiftCheck.closeSource.${w.close_source}`)}
                        </div>
                      )}
                      {/* What he said with each "+30" (owner, 07.11.2026). */}
                      {(w.end_check_notes ?? []).map((n) => (
                        <div key={n.at} className="mt-1 text-xs text-slate">
                          {t('shiftCheck.endCheckNote')} · {timeOf(n.at)}: {n.note}
                        </div>
                      ))}
                      {/* Each break, as it went (owner, 12.11.2026): when, why, each
                          extension with its reason, and when he was back. */}
                      {(w.breaks ?? []).map((b) => (
                        <div key={b.started_at} className="mt-1 rounded-md bg-[#f1f5f9] px-2 py-1 text-xs text-slate">
                          <div>
                            {t('breaksLog.break', { from: timeOf(b.started_at), to: timeOf(b.planned_until) })}
                            {b.reason ? ` · ${b.reason}` : ''}
                          </div>
                          {b.extensions.map((e) => (
                            <div key={e.at} className="text-[#a15c07]">
                              {t('breaksLog.extended', { at: timeOf(e.at), to: timeOf(e.to) })}: {e.reason}
                            </div>
                          ))}
                          <div>{b.ended_at ? t('breaksLog.back', { at: timeOf(b.ended_at) }) : t('breaksLog.notBack', { until: timeOf(b.until) })}</div>
                          {(() => {
                            // Late back (owner, 12.11.2026): from the break's last end
                            // to his return; still out on an open shift, until now.
                            const back = b.ended_at ?? (w.clock_out_at ? null : new Date().toISOString());
                            const late = back ? Math.round((Date.parse(back) - Date.parse(b.until)) / 60_000) : 0;
                            return late > 0 ? (
                              <div className="font-semibold text-[#b91c1c]">
                                {t(b.ended_at ? 'breaksLog.late' : 'breaksLog.lateNow', { min: late })}
                              </div>
                            ) : null;
                          })()}
                        </div>
                      ))}
                      {w.carry_overs.map((c) => (
                        <Link
                          key={c.order_id}
                          to={`/orders/${c.order_id}`}
                          className="mt-1 block text-xs text-[#a15c07] hover:underline"
                        >
                          {t('shiftCheck.carried')}: {c.client_name} —{' '}
                          {carryWhy(c.reason, c.comment)}
                        </Link>
                      ))}
                      {w.corrected_at && (
                        <div className="mt-1 text-xs text-[#1d4ed8]">
                          {t('shiftFix.corrected', { who: w.corrected_by_name ?? '—' })}:{' '}
                          {w.correction_note}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {w.clock_out_at ? (
                        <span className="font-mono text-sm text-slate">
                          {formatDuration(w.duration_minutes ?? 0)}
                        </span>
                      ) : (
                        <span className="rounded-full bg-[#e6f6ec] px-2 py-0.5 text-xs font-medium text-[#15803d]">
                          {t('driverDetail.ongoing')}
                        </span>
                      )}
                      {w.break_minutes > 0 && (
                        <span className="text-[11px] text-slate-light">
                          {t('shiftFix.breakTaken', { d: formatDuration(w.break_minutes) })}
                        </span>
                      )}
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => setFixing(w)}
                          className="text-xs font-medium text-brand hover:text-brand-dark"
                        >
                          {w.clock_out_at ? t('shiftFix.fix') : t('shiftFix.close')}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <Pager page={shiftSafe} count={shiftPages} onPage={setShiftPage} />
            <WorkLogCorrectModal log={fixing} driverId={id} onClose={() => setFixing(null)} />
          </Card>
        </div>
      )}


      <div className="mb-6">
        <StatsStrip stats={statsQ.data} />
      </div>

      {/* Optional per-driver hours; off by default so the driver follows the
          company schedule. */}
      <Card className="mb-6 p-4">
        <h2 className="mb-1 font-display text-lg font-semibold">{t('schedule.driverTitle')}</h2>
        <p className="mb-3 text-sm text-slate">{t('schedule.driverSubtitle')}</p>
        <WorkScheduleEditor driverId={id} />
      </Card>

      <h2 className="mb-3 font-display text-lg font-semibold">{t('orders.title')}</h2>
      {ordersQ.isLoading ? (
        <Spinner />
      ) : (
        <>
          <OrderList orders={orderItems} emptyTitle={t('orders.noMatch')} showDriver={false} />
          <Pager page={orderPage} count={orderPages} onPage={setOrderPage} size="lg" />
        </>
      )}

      <DriverDocumentFormModal
        open={docFormOpen}
        driverId={id}
        editing={editingDoc}
        onClose={() => setDocFormOpen(false)}
      />
      <ConfirmDialog
        open={!!deletingDoc}
        title={t('driverDetail.deleteDocTitle')}
        message={t('driverDetail.deleteDocMessage')}
        pending={deleteDocM.isPending}
        error={deleteDocM.isError ? deleteDocM.error : undefined}
        onClose={() => setDeletingDoc(null)}
        onConfirm={() => deletingDoc && deleteDocM.mutate(deletingDoc.id)}
      />
      <DriverFormModal
        open={editOpen}
        editing={driver ?? null}
        onClose={() => setEditOpen(false)}
      />
      <ConfirmDialog
        open={deleteOpen}
        title={t('team.dismissAsk', { name: driver?.name ?? '' })}
        pending={deleteM.isPending}
        error={deleteM.isError ? deleteM.error : undefined}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => deleteM.mutate()}
      />
    </div>
  );
}
