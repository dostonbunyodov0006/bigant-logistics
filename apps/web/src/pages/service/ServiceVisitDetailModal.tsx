import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FUEL_STATION_FENCE_RADIUS_M, type ServiceCenter, type ServiceVisit } from '@bigant/shared';
import { api } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';
import { Modal } from '../../components/Modal';
import { FenceMap } from '../../components/FenceMap';
import { ErrorNote } from '../../components/ui';
import { FlagTags, OutcomeChip, dayTime, metres, money } from '../fuel/fuelShared';
import { StatusChip, km, useServiceLabels } from './serviceShared';
import { safeHref } from '../../lib/safeHref';

/**
 * One visit on one screen: a photo per work and the receipt on the left,
 * where the truck was and who pays on the right. The money can be corrected
 * until it is paid; the settlement moved the same way as a fuel log's.
 */
export function ServiceVisitDetailModal({ visit, onClose }: { visit: ServiceVisit | null; onClose: () => void }) {
  return (
    <Modal open={!!visit} onClose={onClose} title={visit ? `${visit.driver_name ?? '—'} · ${visit.vehicle_plate ?? ''}` : ''} size="xl">
      {visit && <Body visit={visit} onClose={onClose} />}
    </Modal>
  );
}

function Body({ visit: v, onClose }: { visit: ServiceVisit; onClose: () => void }) {
  const { t } = useTranslation();
  const L = useServiceLabels();
  const [moving, setMoving] = useState(false);
  const [toCenter, setToCenter] = useState('');
  const centersQ = useQuery({ queryKey: ['service', 'centers', 'all'], queryFn: () => api.get<ServiceCenter[]>('/service/centers/all'), enabled: moving });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['service'] });
  const settleM = useMutation({
    mutationFn: (body: { settlement: 'station_invoice' | 'driver_reimbursement'; center_id?: string }) => api.patch<ServiceVisit>(`/service/visits/${v.id}/settlement`, body),
    onSuccess: () => {
      refresh();
      setMoving(false);
    },
  });
  const cancelM = useMutation({
    mutationFn: () => api.del<ServiceVisit>(`/service/visits/${v.id}`),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });

  const place = v.resolved_center ?? v.selected_center;
  const pin = place?.lat != null && place.lng != null ? { lat: place.lat, lng: place.lng } : null;
  const completed = v.status === 'completed';
  const canEditMoney = completed && !v.settled_at;
  const canCancel = v.status !== 'completed' && v.status !== 'cancelled';

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3 text-sm text-slate">
        <StatusChip status={v.status} />
        <span>{L.origin(v)}</span>
        {v.scheduled_at && (
          <>
            <span>·</span>
            <span>{t('service.detail.scheduled', { when: dayTime(v.scheduled_at) })}</span>
          </>
        )}
        {v.completed_at && (
          <>
            <span>·</span>
            <span>{t('service.detail.completed', { when: dayTime(v.completed_at) })}</span>
          </>
        )}
        <span className="flex-1" />
        {v.outcome && <OutcomeChip outcome={v.outcome} />}
        <FlagTags flags={v.flags} />
      </div>

      {(v.note || v.decline_reason || v.assigned_by_name || v.decided_by_name) && (
        <div className="rounded-lg bg-paper px-4 py-3 text-sm text-slate">
          {v.assigned_by_name && <div>{t('service.detail.assignedBy', { name: v.assigned_by_name })}</div>}
          {v.decided_by_name && !v.assigned_by_name && <div>{t(v.status === 'declined' ? 'service.detail.declinedBy' : 'service.detail.approvedBy', { name: v.decided_by_name, when: v.decided_at ? dayTime(v.decided_at) : '' })}</div>}
          {v.decline_reason && <div>„{v.decline_reason}”</div>}
          {v.note && <div>{t('service.detail.note')}: „{v.note}”</div>}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <Eyebrow>{t('service.detail.works')}</Eyebrow>
          <div className="grid gap-2">
            {v.items.map((i) => (
              <div key={i.id} className="flex items-center gap-3 rounded-lg border border-mist p-2">
                {i.photo_url ? (
                  // Every photo of the work — two each since 11.11.2026.
                  <div className="flex flex-none gap-1">
                    {(i.photo_urls?.length ? i.photo_urls : [i.photo_url]).map((u) => (
                      <a key={u} href={safeHref(u)} target="_blank" rel="noreferrer" className="h-16 w-16 overflow-hidden rounded-md bg-[#2a2d33]">
                        <img src={u} alt="" className="h-full w-full object-cover" />
                      </a>
                    ))}
                  </div>
                ) : (
                  <div className="flex h-16 w-16 flex-none items-center justify-center rounded-md border border-dashed border-mist text-xs text-slate-light">—</div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{i.name}</div>
                  <div className="text-xs text-slate">{i.photo_url ? t('service.detail.photoYes') : t('service.detail.photoNo')}</div>
                  {i.remaining_km_at_visit != null && (
                    <div className={`text-xs ${i.remaining_km_at_visit < 0 ? 'font-medium text-red-600' : 'text-slate'}`}>
                      {i.remaining_km_at_visit < 0
                        ? t('service.detail.enteredLate', { km: Math.abs(i.remaining_km_at_visit).toLocaleString('ru-RU') })
                        : t('service.detail.enteredEarly', { km: i.remaining_km_at_visit.toLocaleString('ru-RU') })}
                    </div>
                  )}
                </div>
                {i.cost_sum != null && <div className="font-mono text-sm">{money(i.cost_sum)}</div>}
              </div>
            ))}
          </div>

          <Eyebrow>{t('service.detail.receipt')}</Eyebrow>
          {v.receipt_photo_url ? (
            <a href={safeHref(v.receipt_photo_url)} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg bg-[#2a2d33]">
              <img src={v.receipt_photo_url} alt="" className="h-[220px] w-full object-contain" />
            </a>
          ) : null}
          {v.receipt_photo_url && v.receipt_read_sum != null && (
            <div
              className={`rounded-lg px-4 py-2 text-sm font-medium ${
                v.total_sum != null && Math.abs(v.total_sum - v.receipt_read_sum) > Math.max(1000, v.total_sum * 0.01)
                  ? 'bg-[#fef2f2] text-red-700'
                  : 'bg-[#f0fdf4] text-[#15803d]'
              }`}
            >
              {t(
                v.total_sum != null && Math.abs(v.total_sum - v.receipt_read_sum) > Math.max(1000, v.total_sum * 0.01)
                  ? 'service.detail.receiptMismatch'
                  : 'service.detail.receiptRead',
                { sum: money(v.receipt_read_sum) },
              )}
            </div>
          )}
          {v.receipt_photo_url ? null : v.no_receipt ? (
            <div className="rounded-lg bg-[#fef6e7] px-4 py-3 text-sm font-medium text-[#a15c07]">{t('service.detail.noReceipt')}</div>
          ) : (
            <div className="text-sm text-slate-light">—</div>
          )}

          <Eyebrow>{t('service.detail.numbers')}</Eyebrow>
          <div>
            <Row k={t('service.detail.odometer')} v={v.odometer_km != null ? `${km(v.odometer_km)} km` : '—'} mono />
            {canEditMoney ? <TotalEditor visit={v} /> : <Row k={t('service.detail.total')} v={v.total_sum != null ? `${money(v.total_sum)} so'm` : '—'} mono last />}
            {v.original_total_sum != null && v.reviewed_at && (
              <div className="pt-2 text-xs text-slate">
                {t('service.detail.corrected', { from: money(v.original_total_sum), by: v.reviewed_by_name ?? '', when: dayTime(v.reviewed_at) })}
              </div>
            )}
          </div>

          {/* What the driver wanted the office to know when closing the visit —
              their words, not a field: kept apart from the note on the request. */}
          {v.driver_comment && (
            <>
              <Eyebrow>{t('service.detail.driverComment')}</Eyebrow>
              <div className="rounded-lg bg-paper px-4 py-3 text-sm leading-relaxed text-ink">„{v.driver_comment}”</div>
            </>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <Eyebrow>{t('fuel.detail.location')}</Eyebrow>
          {v.capture || v.tracked || pin ? (
            <FenceMap pin={pin} capture={v.capture} tracked={v.tracked} radiusM={FUEL_STATION_FENCE_RADIUS_M} />
          ) : (
            <div className="rounded-lg bg-paper p-4 text-sm text-slate">{v.status === 'completed' || v.status === 'in_progress' ? t('fuel.detail.noPosition') : t('service.detail.notStarted')}</div>
          )}
          <div>
            <Row k={t('fuel.detail.driverPicked')} v={v.selected_center?.name ?? t('service.street')} />
            {v.outcome && (
              <Row
                k={t('fuel.detail.actually')}
                v={
                  v.outcome === 'matched'
                    ? t('fuel.detail.actuallyMatched', { d: v.distance_m != null ? metres(v.distance_m) : '' })
                    : v.outcome === 'other_station'
                      ? t('service.detail.actuallyOther', { name: v.resolved_center?.name ?? '—', d: v.distance_m != null ? metres(v.distance_m) : '' })
                      : v.outcome === 'mismatch'
                        ? t('fuel.detail.actuallyElsewhere', { d: v.distance_m != null ? metres(v.distance_m) : '?' })
                        : v.outcome === 'unlisted'
                          ? t('service.detail.actuallyUnlisted')
                          : t('fuel.detail.actuallyUnknown')
                }
                tone={v.outcome === 'matched' ? 'ok' : v.outcome === 'mismatch' ? 'bad' : undefined}
              />
            )}
            <Row k={t('fuel.detail.accuracy')} v={v.capture?.accuracy_m != null ? `± ${Math.round(v.capture.accuracy_m)} m` : '—'} mono last />
          </div>

          {completed && (
            <>
              <Eyebrow>{t('fuel.detail.settlement')}</Eyebrow>
              {!v.settlement ? (
                <div className="rounded-lg bg-[#fef6e7] px-4 py-3 text-sm font-medium text-[#a15c07]">{t('fuel.detail.settlementPending')}</div>
              ) : (
                <div className={`rounded-lg px-4 py-3 text-sm font-medium ${v.settlement === 'station_invoice' ? 'bg-[#e6f6ec] text-[#15803d]' : 'bg-brand-tint text-brandDark'}`}>
                  {v.settlement === 'station_invoice' ? t('service.detail.settlementCenter', { name: v.resolved_center?.name ?? '—' }) : t('fuel.detail.settlementDriver')}
                  {v.settled_at ? ` · ${t('fuel.detail.settlementPaid', { date: dayTime(v.settled_at) })}` : ''}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {(canEditMoney || canCancel) && (
        <div className="-mx-5 -mb-5 flex flex-wrap items-center gap-2 border-t border-mist bg-paper px-5 py-3">
          {canEditMoney &&
            (moving ? (
              <>
                <label className="sr-only" htmlFor="settle-center">{t('service.detail.chooseCenter')}</label>
                <select id="settle-center" className="input max-w-xs" value={toCenter} onChange={(e) => setToCenter(e.target.value)}>
                  <option value="">{t('service.detail.chooseCenter')}</option>
                  {centersQ.data?.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button type="button" className="btn-primary" disabled={!toCenter || settleM.isPending} onClick={() => settleM.mutate({ settlement: 'station_invoice', center_id: toCenter })}>
                  {t('fuel.detail.apply')}
                </button>
                <button type="button" className="btn-ghost" onClick={() => setMoving(false)}>{t('fuel.stations.cancel')}</button>
              </>
            ) : (
              <>
                <button type="button" className="btn-ghost" onClick={() => { setMoving(true); setToCenter(v.resolved_center?.id ?? v.selected_center?.id ?? ''); }}>
                  {t('service.detail.moveToCenter')}
                </button>
                {v.settlement !== 'driver_reimbursement' && (
                  <button type="button" className="btn-ghost" disabled={settleM.isPending} onClick={() => settleM.mutate({ settlement: 'driver_reimbursement' })}>
                    {t('fuel.detail.markDriver')}
                  </button>
                )}
              </>
            ))}
          {canCancel && (
            <button
              type="button"
              className="btn-ghost text-[#dc2626]"
              disabled={cancelM.isPending}
              onClick={() => {
                if (window.confirm(t('service.detail.cancelConfirm'))) cancelM.mutate();
              }}
            >
              {t('service.detail.cancelVisit')}
            </button>
          )}
          <span className="flex-1" />
          {(settleM.isError || cancelM.isError) && <ErrorNote error={settleM.error ?? cancelM.error} />}
        </div>
      )}
    </div>
  );
}

/** The total as a field, for the person with the receipt in front of them. */
function TotalEditor({ visit: v }: { visit: ServiceVisit }) {
  const { t } = useTranslation();
  const [value, setValue] = useState(String(v.total_sum ?? ''));
  useEffect(() => setValue(String(v.total_sum ?? '')), [v.total_sum]);
  const n = Number(value.replace(/\s/g, '').replace(',', '.'));
  const valid = value.trim() !== '' && Number.isFinite(n) && n >= 0;
  const dirty = valid && n !== v.total_sum;
  const saveM = useMutation({
    mutationFn: () => api.patch<ServiceVisit>(`/service/visits/${v.id}/total`, { total_sum: n }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['service'] }),
  });
  return (
    <div>
      <label htmlFor="sv-total" className="flex items-center justify-between gap-3 py-1.5 text-sm">
        <span className="text-slate">{t('service.detail.total')}</span>
        <span className="flex items-center gap-2">
          <input id="sv-total" className="input w-40 text-right font-mono font-semibold" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          <span className="text-xs text-slate-light">so'm</span>
          <button type="button" className="btn-primary" disabled={!dirty || saveM.isPending} onClick={() => saveM.mutate()}>
            {t('fuel.detail.saveNumbers')}
          </button>
        </span>
      </label>
      {saveM.isError && <ErrorNote error={saveM.error} />}
    </div>
  );
}

function Eyebrow({ children }: { children: string }) {
  return <div className="text-[11px] font-bold uppercase tracking-wider text-slate">{children}</div>;
}
function Row({ k, v, mono, tone, last }: { k: string; v: string; mono?: boolean; tone?: 'ok' | 'bad'; last?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 py-2 text-sm ${last ? '' : 'border-b border-mist'}`}>
      <span className="text-slate">{k}</span>
      <span className={`text-right font-semibold ${mono ? 'font-mono' : ''} ${tone === 'ok' ? 'text-[#15803d]' : tone === 'bad' ? 'text-[#dc2626]' : ''}`}>{v}</span>
    </div>
  );
}
