import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ServiceDueItem, ServiceVisit } from '@bigant/shared';
import { api } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';
import { Card, DataTable, EmptyState, ErrorNote, Spinner, type Column } from '../../components/ui';
import { dayTime } from '../fuel/fuelShared';
import { StatusChip, km, useAgo, useServiceLabels } from './serviceShared';

/**
 * Requests the driver sent with a date and time. Yes or no, nothing else —
 * if the date is wrong, decline with a word and the driver sends another.
 */
export function ServiceRequestsTab() {
  const { t } = useTranslation();
  const L = useServiceLabels();
  const ago = useAgo();
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const q = useQuery({ queryKey: ['service', 'visits', 'requested'], queryFn: () => api.get<ServiceVisit[]>('/service/visits?status=requested'), refetchInterval: 30_000 });
  const dueQ = useQuery({ queryKey: ['service', 'due'], queryFn: () => api.get<ServiceDueItem[]>('/service/due') });
  const recentQ = useQuery({
    queryKey: ['service', 'visits', 'decided'],
    queryFn: async () => {
      const [a, d] = await Promise.all([
        api.get<ServiceVisit[]>('/service/visits?origin=request&status=approved'),
        api.get<ServiceVisit[]>('/service/visits?origin=request&status=declined'),
      ]);
      return [...a, ...d].filter((v) => v.decided_at).sort((x, y) => y.decided_at!.localeCompare(x.decided_at!)).slice(0, 10);
    },
  });

  const done = () => {
    setDeclining(null);
    setReason('');
    void queryClient.invalidateQueries({ queryKey: ['service'] });
  };
  const approveM = useMutation({ mutationFn: (id: string) => api.post<ServiceVisit>(`/service/visits/${id}/approve`), onSuccess: done });
  const declineM = useMutation({
    mutationFn: (v: { id: string; reason: string }) => api.post<ServiceVisit>(`/service/visits/${v.id}/decline`, { reason: v.reason || null }),
    onSuccess: done,
  });

  /** How far the requested works are, from the due list — context for the yes. */
  const dueLine = (v: ServiceVisit): string | null => {
    const parts = v.items
      .map((i) => (dueQ.data ?? []).find((d) => d.vehicle_id === v.vehicle_id && d.reason_id === i.reason_id))
      .filter((d): d is ServiceDueItem => !!d && d.remaining_km != null)
      .map((d) => `${d.reason_name}: ${L.remaining(d.remaining_km)}`);
    return parts.length ? parts.join(' · ') : null;
  };

  const currentKm = (v: ServiceVisit) => (dueQ.data ?? []).find((d) => d.vehicle_id === v.vehicle_id)?.current_km ?? null;

  const rows = q.data ?? [];
  const recent = recentQ.data ?? [];
  const recentCols: Column<ServiceVisit>[] = [
    { key: 'who', header: t('service.visits.colDriver'), render: (v) => <span><b>{v.driver_name ?? '—'}</b> · {v.vehicle_model} {v.vehicle_plate}</span> },
    { key: 'works', header: t('service.visits.colWorks'), render: (v) => L.works(v) },
    { key: 'when', header: t('service.requests.colWhen'), render: (v) => (v.scheduled_at ? dayTime(v.scheduled_at) : '—') },
    { key: 'status', header: t('service.visits.colStatus'), render: (v) => <span className="flex items-center gap-2"><StatusChip status={v.status} />{v.decline_reason && <span className="text-xs text-slate">{v.decline_reason}</span>}</span> },
    { key: 'by', header: '', className: 'text-right text-slate-light', render: (v) => `${v.decided_by_name ?? ''} · ${ago(v.decided_at)}` },
  ];

  return (
    <>
      {q.isLoading ? (
        <Card><Spinner /></Card>
      ) : rows.length === 0 ? (
        <Card><EmptyState title={t('service.requests.empty')} hint={t('service.requests.emptyHint')} /></Card>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((v) => (
            <Card key={v.id} className="p-4">
              <div className="flex flex-wrap items-center gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="font-semibold">{v.driver_name ?? '—'} · {v.vehicle_model} {v.vehicle_plate}</span>
                    <span className="rounded-full bg-[#eef1f5] px-2.5 py-0.5 text-xs font-semibold text-slate">{t('service.origin.request')}</span>
                  </div>
                  <div className="mt-1 text-sm">{L.works(v)}</div>
                  <div className="mt-1 text-xs text-slate">
                    <b className="text-ink">{v.scheduled_at ? dayTime(v.scheduled_at) : '—'}</b>
                    {v.selected_center ? ` · ${v.selected_center.name}` : ''}
                    {dueLine(v) ? ` · ${dueLine(v)}` : ''}
                    {v.note ? ` · „${v.note}”` : ''}
                    {currentKm(v) != null ? ` · ${km(currentKm(v)!)} km` : ''}
                  </div>
                </div>
                {declining === v.id ? (
                  <div className="flex flex-none flex-wrap items-center gap-2">
                    <input
                      className="input w-64"
                      placeholder={t('service.requests.declinePlaceholder')}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      maxLength={300}
                      autoFocus
                      aria-label={t('service.requests.declineReason')}
                    />
                    <button type="button" className="btn-ghost text-[#dc2626]" disabled={declineM.isPending} onClick={() => declineM.mutate({ id: v.id, reason: reason.trim() })}>
                      {t('service.requests.decline')}
                    </button>
                    <button type="button" className="btn-ghost" onClick={() => setDeclining(null)}>{t('fuel.stations.cancel')}</button>
                  </div>
                ) : (
                  <div className="flex flex-none gap-2">
                    <button type="button" className="btn-primary" disabled={approveM.isPending} onClick={() => approveM.mutate(v.id)}>
                      {t('service.requests.approve')}
                    </button>
                    <button type="button" className="btn-ghost text-[#dc2626]" onClick={() => { setDeclining(v.id); setReason(''); }}>
                      {t('service.requests.decline')}
                    </button>
                  </div>
                )}
              </div>
            </Card>
          ))}
          {(approveM.isError || declineM.isError) && <ErrorNote error={approveM.error ?? declineM.error} />}
        </div>
      )}

      {recent.length > 0 && (
        <>
          <div className="mb-2 mt-6 text-[11px] font-bold uppercase tracking-wider text-slate-light">{t('service.requests.recent')}</div>
          <Card>
            <DataTable columns={recentCols} rows={recent} keyOf={(v) => v.id} />
          </Card>
        </>
      )}
    </>
  );
}
