import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { IdleReport as IdleReportData, IdleRow } from '@bigant/shared';
import { api } from '../lib/api';
import { Card, ErrorNote, Spinner } from './ui';
import { TZ } from '../lib/tashkent';
import { saveXlsx } from '../pages/PayrollPage';

function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Ish vaqti (owner, 05.11.2026): each lorry, or each driver, from "Ishni
 * boshlash" to "Ishni tugatish" — hours worked, on orders, and idle with no
 * order in hand (lunch hour out); a row opens to its days. The Excel gives the
 * period's totals.
 */
export function IdleReport({ from, to }: { from: string; to: string }) {
  const { t } = useTranslation();
  const [by, setBy] = useState<'vehicles' | 'drivers'>('vehicles');
  const [open, setOpen] = useState<string | null>(null);
  const qs = `from=${from}&to=${to}`;
  const { data, isLoading } = useQuery({
    queryKey: ['idle-report', qs],
    queryFn: () => api.get<IdleReportData>(`/drivers/idle-report?${qs}`),
    enabled: !!from && !!to,
  });
  const excelM = useMutation({
    mutationFn: () => api.get<{ filename: string; base64: string }>(`/drivers/idle-report/export?${qs}`),
    onSuccess: saveXlsx,
  });
  const rows: IdleRow[] = data?.[by] ?? [];

  const cols =
    'grid grid-cols-[minmax(0,1fr)_4.2rem_4.2rem_3.6rem_4.2rem] items-center gap-1.5 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_6rem_7rem] sm:gap-2';
  type Times = { worked_minutes: number; busy_minutes: number; lunch_minutes: number; idle: number };
  const nums = (x: Times, strong = false) => (
    <>
      <span className="text-right font-mono">{formatHours(x.worked_minutes)}</span>
      <span className="text-right font-mono">{formatHours(x.busy_minutes)}</span>
      <span className="text-right font-mono text-slate">{formatHours(x.lunch_minutes)}</span>
      <span className={`text-right font-mono ${strong ? 'font-semibold text-brand-dark' : ''}`}>{formatHours(x.idle)}</span>
    </>
  );
  const head = (
    <div className={`${cols} px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate`}>
      <span />
      <span className="text-right">{t('workReport.colWorked')}</span>
      <span className="text-right">{t('workReport.colBusy')}</span>
      <span className="text-right">{t('workReport.colLunch')}</span>
      <span className="text-right">{t('workReport.colIdle')}</span>
    </div>
  );
  const park: Times = {
    worked_minutes: rows.reduce((a, r) => a + r.worked_minutes, 0),
    busy_minutes: rows.reduce((a, r) => a + r.busy_minutes, 0),
    lunch_minutes: rows.reduce((a, r) => a + r.lunch_minutes, 0),
    idle: rows.reduce((a, r) => a + r.total_minutes, 0),
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(['vehicles', 'drivers'] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={by === k}
              onClick={() => {
                setBy(k);
                setOpen(null);
              }}
              className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${
                by === k ? 'border-brand bg-brand text-white' : 'border-mist bg-white text-ink hover:border-brand'
              }`}
            >
              {t(k === 'vehicles' ? 'workReport.idleVehicles' : 'workReport.idleDrivers')}
            </button>
          ))}
        </div>
        <button type="button" className="btn-ghost" disabled={excelM.isPending || !rows.length} onClick={() => excelM.mutate()}>
          {t('workReport.idleExcel')}
        </button>
      </div>
      {excelM.isError ? <ErrorNote error={excelM.error} /> : null}
      <Card>
        {isLoading ? (
          <Spinner />
        ) : !rows.length ? (
          <p className="px-4 py-6 text-center text-sm text-slate">{t('workReport.noData')}</p>
        ) : (
          <div className="divide-y divide-mist/60 text-sm">
            {/* The whole park at a glance (owner, 05.11.2026). */}
            <div className="bg-brand/5">
              {head}
              <div className={`${cols} px-4 pb-3 pt-1 font-semibold text-ink`}>
                <span className="min-w-0 truncate">{t('workReport.parkTotal')}</span>
                {nums(park, true)}
              </div>
            </div>
            {rows.map((r) => (
              <div key={r.id}>
                <button
                  type="button"
                  onClick={() => setOpen(open === r.id ? null : r.id)}
                  aria-expanded={open === r.id}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-mist/20"
                >
                  <span className="min-w-0 truncate">
                    <span className="font-semibold text-ink">{r.name}</span>
                    {by === 'vehicles' && r.sub ? <span className="ml-2 text-slate">{r.sub}</span> : null}
                  </span>
                  <span className="shrink-0 text-slate-light">{open === r.id ? '▴' : '▾'}</span>
                </button>
                {open === r.id ? (
                  <div className="divide-y divide-mist/40 bg-mist/10 pb-1">
                    {head}
                    {r.days.map((d) => (
                      <div key={d.date} className={`${cols} px-4 py-1.5`}>
                        <span className="font-mono text-slate">
                          {new Date(`${d.date}T00:00:00`).toLocaleDateString(undefined, {
                            timeZone: TZ,
                            weekday: 'short',
                            day: '2-digit',
                            month: '2-digit',
                          })}
                        </span>
                        {nums({ ...d, idle: d.minutes }, true)}
                      </div>
                    ))}
                    <div className={`${cols} px-4 py-2 font-semibold`}>
                      <span>{t('workReport.idleTotal')}</span>
                      {nums({ ...r, idle: r.total_minutes })}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
