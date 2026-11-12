import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { WorkSchedule, WorkScheduleDay } from '@bigant/shared';
import { api } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { ErrorNote, ValidationNote } from './ui';

// 0 = Sunday .. 6 = Saturday, displayed Monday-first.
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_KEY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/**
 * Per-weekday schedule editor, used for both the organisation default and a
 * per-driver override (`driverId`). Rows left untouched fall back a layer:
 * driver → organisation → work settings.
 */
export function WorkScheduleEditor({ driverId }: { driverId?: string }) {
  const { t } = useTranslation();
  const path = driverId ? `/attendance/schedule/${driverId}` : '/attendance/schedule';
  const key = ['attendance', 'schedule', driverId ?? 'org'];

  const { data } = useQuery({ queryKey: key, queryFn: () => api.get<WorkSchedule>(path) });

  const [days, setDays] = useState<WorkScheduleDay[]>([]);
  const [enabled, setEnabled] = useState(false);

  const [attempted, setAttempted] = useState(false);
  useEffect(() => {
    if (!data) return;
    setEnabled(data.days.length > 0);
    setDays(
      ORDER.map(
        (weekday) =>
          data.days.find((d) => d.weekday === weekday) ?? {
            weekday,
            is_day_off: weekday === 0,
            start_time: '09:00',
            end_time: '18:00',
          },
      ),
    );
  }, [data]);

  const saveM = useMutation({
    mutationFn: (payload: WorkScheduleDay[]) => api.put<WorkSchedule>(path, { days: payload }),
    onSuccess: () => {
      setAttempted(false);
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });

  const patch = (weekday: number, next: Partial<WorkScheduleDay>) =>
    setDays((prev) => prev.map((d) => (d.weekday === weekday ? { ...d, ...next } : d)));

  const invalidDay = days.find(
    (day) => !day.is_day_off && (!day.start_time || !day.end_time || day.start_time >= day.end_time),
  );
  const save = () => {
    setAttempted(true);
    if (invalidDay) {
      document.getElementById('schedule-start-' + invalidDay.weekday)?.focus();
      return;
    }
    saveM.mutate(days);
  };

  return (
    <div>
      {driverId && (
        <label className="mb-3 flex items-center gap-2 text-sm text-graphite">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              // Unchecking clears the override immediately — the driver goes
              // back to following the company schedule.
              if (!e.target.checked) saveM.mutate([]);
            }}
          />
          {t('schedule.overrideForDriver')}
        </label>
      )}

      {(!driverId || enabled) && (
        <>
          <div className="space-y-2">
            {days.map((d) => (
              <div key={d.weekday} className="grid grid-cols-[7rem_auto_1fr_1fr] items-center gap-3">
                <span className="text-sm font-medium text-ink">{t(`schedule.${DAY_KEY[d.weekday]}`)}</span>
                <label className="flex items-center gap-1.5 text-xs text-slate">
                  <input
                    type="checkbox"
                    checked={d.is_day_off}
                    onChange={(e) => patch(d.weekday, { is_day_off: e.target.checked })}
                  />
                  {t('schedule.dayOff')}
                </label>
                <input
                  id={`schedule-start-${d.weekday}`}
                  type="time"
                  className="input"
                  disabled={d.is_day_off}
                  value={d.start_time}
                  onChange={(e) => patch(d.weekday, { start_time: e.target.value })}
                />
                <input
                  id={`schedule-end-${d.weekday}`}
                  type="time"
                  className="input"
                  disabled={d.is_day_off}
                  value={d.end_time}
                  onChange={(e) => patch(d.weekday, { end_time: e.target.value })}
                />
              </div>
            ))}
          </div>
          <div className="mt-3">
            <ValidationNote show={attempted && !!invalidDay} />
          </div>
          <button
            type="button"
            className="btn-primary mt-4"
            disabled={saveM.isPending}
            onClick={save}
          >
            {saveM.isPending ? t('common.saving') : t('common.saveChanges')}
          </button>
          {saveM.isSuccess && <span className="ml-3 text-sm text-success">{t('settings.saved')}</span>}
          {saveM.isError && <div className="mt-3"><ErrorNote error={saveM.error} /></div>}
        </>
      )}

      {driverId && !enabled && <p className="text-sm text-slate">{t('schedule.inheriting')}</p>}
    </div>
  );
}
