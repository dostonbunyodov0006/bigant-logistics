import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { AttendanceDay, AttendanceReport, AttendanceStatus } from '@bigant/shared';
import { api } from '../lib/api';
import { Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { tkMonthStart, tkYmd } from '../lib/tashkent';

function ymd(d: Date): string {
  return tkYmd(d);
}
function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** One letter per cell — the grid has to stay readable across a whole month. */
const CELL: Record<AttendanceStatus, { bg: string; text: string; short: string }> = {
  present: { bg: 'bg-emerald-100', text: 'text-emerald-800', short: '✓' },
  late: { bg: 'bg-amber-200', text: 'text-amber-900', short: 'L' },
  absent: { bg: 'bg-red-200', text: 'text-red-900', short: 'A' },
  on_leave: { bg: 'bg-sky-100', text: 'text-sky-800', short: 'R' },
  day_off: { bg: 'bg-slate-100', text: 'text-slate-400', short: '·' },
  not_started: { bg: 'bg-white', text: 'text-slate-300', short: '–' },
};

const LEGEND: AttendanceStatus[] = ['present', 'late', 'absent', 'on_leave', 'day_off'];

function cellTitle(day: AttendanceDay, label: string): string {
  const bits = [`${day.date} — ${label}`];
  if (day.first_clock_in) {
    bits.push(`${day.first_clock_in}${day.last_clock_out ? `–${day.last_clock_out}` : ''}`);
  }
  if (day.late_minutes > 0) bits.push(`+${day.late_minutes}m`);
  if (day.early_minutes > 0) bits.push(`-${day.early_minutes}m`);
  if (day.late_reason) bits.push(day.late_reason);
  if (day.early_leave_reason) bits.push(day.early_leave_reason);
  return bits.join(' · ');
}

/** Corner marks for what the end-of-day check found on the day. */
const MARK = {
  auto_closed: 'bg-[#dc2626]',
  viloyat: 'bg-[#1d4ed8]',
} as const;

export function AttendancePage() {
  const { t } = useTranslation();
  const now = new Date();
  const [from, setFrom] = useState(tkMonthStart());
  const [to, setTo] = useState(ymd(now));

  const qs = `from=${from}&to=${to}`;
  const { data, isLoading } = useQuery({
    queryKey: ['attendance', qs],
    queryFn: () => api.get<AttendanceReport>(`/attendance?${qs}`),
    enabled: !!from && !!to,
  });

  const rows = data?.rows ?? [];
  const dates = data?.dates ?? [];

  return (
    <div>
      <PageHeader title={t('attendance.title')} subtitle={t('attendance.subtitle')} />

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="field-label" htmlFor="att-from">
              {t('attendance.from')}
            </label>
            <input
              id="att-from"
              type="date"
              className="input"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="att-to">
              {t('attendance.to')}
            </label>
            <input
              id="att-to"
              type="date"
              className="input"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate">
          {LEGEND.map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span
                className={`inline-flex h-5 w-5 items-center justify-center rounded font-bold ${CELL[s].bg} ${CELL[s].text}`}
              >
                {CELL[s].short}
              </span>
              {t(`attendance.status.${s}`)}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${MARK.auto_closed}`} />
            {t('shiftCheck.legendAutoClosed')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${MARK.viloyat}`} />
            {t('shiftCheck.legendViloyat')}
          </span>
        </div>
      </Card>

      <Card>
        {isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState title={t('attendance.noData')} hint={t('attendance.noDataHint')} />
        ) : (
          // The day grid can be a month wide, so it scrolls on its own.
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-mist">
                  <th className="sticky left-0 z-10 bg-white px-4 py-2 text-left font-semibold text-slate">
                    {t('attendance.colDriver')}
                  </th>
                  {dates.map((d) => (
                    <th
                      key={d}
                      className="px-1 py-2 text-center font-mono text-[11px] font-medium text-slate-400"
                    >
                      {d.slice(8)}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-semibold text-slate">
                    {t('attendance.colLate')}
                  </th>
                  <th className="px-3 py-2 text-right font-semibold text-slate">
                    {t('attendance.colAbsent')}
                  </th>
                  <th className="px-3 py-2 text-right font-semibold text-slate">
                    {t('attendance.colWorked')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.driver_id} className="border-b border-mist/60">
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-4 py-2 font-medium text-ink">
                      {r.name}
                    </td>
                    {r.days.map((day) => {
                      const c = CELL[day.status];
                      return (
                        <td key={day.date} className="px-1 py-1.5 text-center">
                          <span
                            title={[
                              cellTitle(day, t(`attendance.status.${day.status}`)),
                              day.auto_closed ? t('shiftCheck.legendAutoClosed') : null,
                              day.viloyat ? t('shiftCheck.legendViloyat') : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                            className={`relative inline-flex h-6 w-6 items-center justify-center rounded text-[11px] font-bold ${c.bg} ${c.text}`}
                          >
                            {c.short}
                            {day.auto_closed && (
                              <span
                                className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-1 ring-white ${MARK.auto_closed}`}
                              />
                            )}
                            {day.viloyat && (
                              <span
                                className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-1 ring-white ${MARK.viloyat}`}
                              />
                            )}
                          </span>
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-right font-mono text-ink">
                      {r.times_late > 0 ? `${r.times_late} (${r.total_late_minutes}m)` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      <span className={r.days_absent > 0 ? 'font-bold text-danger' : 'text-slate'}>
                        {r.days_absent}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate">
                      {formatHours(r.days.reduce((s, d) => s + d.worked_minutes, 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
