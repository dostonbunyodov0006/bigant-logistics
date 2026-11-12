import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { SERVICE_DUE_SOON_KM, type ServiceDueItem, type ServiceSummary } from '@bigant/shared';
import { api } from '../../lib/api';
import { Card, EmptyState, Spinner, type Column } from '../../components/ui';
import { downloadCsv, money } from '../fuel/fuelShared';
import { RemainingChip, km, useAgo } from './serviceShared';
import { AssignVisitModal } from './AssignVisitModal';
import { BaselineModal } from './BaselineModal';
import { VehicleBaselineModal } from './VehicleBaselineModal';

type Scope = 'attention' | 'all';

/**
 * One row per lorry, its most urgent work on it; a press opens all its works
 * underneath (owner, 30.10.2026 — seven rows per lorry were unreadable). The
 * lorry's starting km for every work is set in one window.
 */
export function ServiceDueTab({ summary }: { summary: ServiceSummary | undefined }) {
  const { t } = useTranslation();
  const ago = useAgo();
  const [scope, setScope] = useState<Scope>('attention');
  const [assign, setAssign] = useState<ServiceDueItem | null>(null);
  const [baseline, setBaseline] = useState<ServiceDueItem | null>(null);
  const [vehicleBaseline, setVehicleBaseline] = useState<ServiceDueItem[] | null>(null);
  // One lorry open at a time: opening another closes the one before (owner, 30.10.2026).
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (id: string) => setOpen((cur) => (cur === id ? null : id));

  const q = useQuery({ queryKey: ['service', 'due'], queryFn: () => api.get<ServiceDueItem[]>('/service/due'), refetchInterval: 60_000 });
  const all = q.data ?? [];
  const rows = useMemo(
    () => (scope === 'all' ? all : all.filter((d) => d.remaining_km == null || d.remaining_km <= SERVICE_DUE_SOON_KM)),
    [all, scope],
  );
  const unknown = all.filter((d) => d.remaining_km == null).length;
  // Most urgent first: overdue, then the fewest km left; works with no km last.
  const urgency = (d: ServiceDueItem) => (d.remaining_km == null ? Number.MAX_SAFE_INTEGER : d.remaining_km);
  const vehicles = useMemo(() => {
    const by = new Map<string, ServiceDueItem[]>();
    for (const d of rows) by.set(d.vehicle_id, [...(by.get(d.vehicle_id) ?? []), d]);
    return [...by.values()]
      .map((works) => [...works].sort((a, b) => urgency(a) - urgency(b)))
      .sort((a, b) => urgency(a[0]!) - urgency(b[0]!));
  }, [rows]);
  const worksOf = (vehicleId: string) => all.filter((d) => d.vehicle_id === vehicleId);

  const columns: Column<ServiceDueItem>[] = [
    { key: 'work', header: t('service.due.colWork'), render: (d) => d.reason_name },
    {
      key: 'due',
      header: t('service.due.colDue'),
      className: 'text-right',
      render: (d) => (
        <span className="font-mono text-slate">
          {d.due_km != null ? km(d.due_km) : (
            <button type="button" className="text-brand underline-offset-2 hover:underline" onClick={() => setBaseline(d)}>
              {t('service.due.setBaseline')}
            </button>
          )}
        </span>
      ),
    },
    { key: 'state', header: t('service.due.colState'), render: (d) => <RemainingChip item={d} /> },
    {
      key: 'told',
      header: t('service.due.colTold'),
      render: (d) => (
        <div className="text-xs">
          {d.reminders_sent > 0 ? (
            <div>{t('service.due.toldTimes', { n: d.reminders_sent, when: ago(d.last_reminded_at) })}</div>
          ) : (
            <div className="text-slate-light">{d.remaining_km != null && d.remaining_km > SERVICE_DUE_SOON_KM ? t('service.due.notYetAt') : t('service.due.notYet')}</div>
          )}
          {d.open_visit_id && (d.open_visit_status === 'requested' || d.open_visit_status === 'approved' || d.open_visit_status === 'in_progress') ? (
            <div className="text-[#15803d]">{t(`service.due.open.${d.open_visit_status}`)}</div>
          ) : d.remaining_km != null && d.remaining_km < 0 ? (
            <div className="text-[#dc2626]">{t('service.due.noRequest')}</div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'act',
      header: '',
      className: 'text-right',
      render: (d) =>
        d.open_visit_id ? (
          <span className="text-xs text-slate-light">{t('service.due.covered')}</span>
        ) : (
          <button type="button" className="btn-primary" disabled={!d.driver_id} onClick={() => setAssign(d)}>
            {t('service.due.send')}
          </button>
        ),
    },
  ];

  const exportCsv = () =>
    downloadCsv(
      'service-due.csv',
      ['vehicle', 'driver', 'work', 'interval_km', 'current_km', 'last_done_km', 'due_km', 'remaining_km', 'reminders_sent', 'open_visit'],
      all.map((d) => [d.vehicle_plate, d.driver_name, d.reason_name, d.interval_km, d.current_km, d.last_done_km, d.due_km, d.remaining_km, d.reminders_sent, d.open_visit_status]),
    );

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="p-5">
          <div className={`font-mono text-2xl font-semibold ${summary?.overdue ? 'text-[#dc2626]' : 'text-ink'}`}>{summary?.overdue ?? 0}</div>
          <div className="mt-1 text-sm text-slate">{t('service.tileOverdue')}</div>
        </Card>
        <Card className="p-5">
          <div className={`font-mono text-2xl font-semibold ${summary?.due_soon ? 'text-[#a15c07]' : 'text-ink'}`}>{summary?.due_soon ?? 0}</div>
          <div className="mt-1 text-sm text-slate">{t('service.tileDueSoon')}</div>
        </Card>
        <Card className="p-5">
          <div className="font-mono text-2xl font-semibold text-ink">{summary?.pending_requests ?? 0}</div>
          <div className="mt-1 text-sm text-slate">{t('service.tileRequests')}</div>
        </Card>
        <Card className="p-5">
          <div className="font-mono text-2xl font-semibold text-ink">{summary?.visits ?? 0}</div>
          <div className="mt-1 text-sm text-slate">{t('service.tileVisits')}</div>
          <div className="text-xs text-slate-light">{money(summary?.total_sum ?? 0)} so'm</div>
        </Card>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-mist bg-white p-0.5">
          {(['attention', 'all'] as Scope[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold ${scope === s ? 'bg-brand-tint text-brandDark' : 'text-slate hover:text-ink'}`}
            >
              {t(`service.due.scope.${s}`)}
            </button>
          ))}
        </div>
        {unknown > 0 && <span className="text-xs text-slate">{t('service.due.unknownCount', { n: unknown })}</span>}
        <span className="flex-1" />
        <button type="button" className="btn-ghost" disabled={all.length === 0} onClick={exportCsv}>
          {t('fuel.downloadCsv')}
        </button>
      </div>

      <Card>
        {q.isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState title={t(scope === 'all' ? 'service.due.emptyAll' : 'service.due.empty')} hint={scope === 'all' ? undefined : t('service.due.emptyHint')} />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-mist text-left text-xs font-semibold text-slate">
                <th className="px-4 py-2.5">{t('service.due.colVehicle')}</th>
                <th className="px-4 py-2.5 text-right">{t('service.due.colCurrent')}</th>
                <th className="px-4 py-2.5">{t('service.due.colNearest')}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {vehicles.map((works) => {
                const v = works[0]!;
                const isOpen = open === v.vehicle_id;
                return (
                  <Fragment key={v.vehicle_id}>
                    <tr className="cursor-pointer border-b border-mist/60 hover:bg-paper" onClick={() => toggle(v.vehicle_id)}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`text-slate transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</span>
                          <div>
                            <div className="font-medium">{v.vehicle_model} · {v.vehicle_plate}</div>
                            <div className="text-xs text-slate">{v.driver_name ?? t('service.due.noDriver')}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono">{v.current_km != null ? km(v.current_km) : '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span>{v.reason_name}</span>
                          <RemainingChip item={v} />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="btn-ghost" onClick={() => setVehicleBaseline(worksOf(v.vehicle_id))}>
                          {t('service.due.setBaselineAll')}
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-mist/60 bg-paper/60">
                        <td colSpan={4} className="px-4 py-2">
                          <table className="w-full text-sm">
                            <tbody>
                              {works.map((d) => (
                                <tr key={d.reason_id} className="border-b border-mist/40 last:border-0">
                                  {columns.map((c) => (
                                    <td key={c.key} className={`px-3 py-2 ${c.className ?? ''}`}>{c.render(d)}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <AssignVisitModal item={assign} onClose={() => setAssign(null)} />
      <BaselineModal item={baseline} onClose={() => setBaseline(null)} />
      <VehicleBaselineModal works={vehicleBaseline} onClose={() => setVehicleBaseline(null)} />
    </>
  );
}
