import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { WorkSettings } from '@bigant/shared';
import { api } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { Card, ErrorNote, PageHeader, Spinner, ValidationNote } from '../components/ui';

// Display order Monday..Sunday; values are weekday numbers (0 = Sunday).
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY_KEY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * Kunlik ish soati: the working day — expected hours, work days, the late
 * grace, the shift's start and end. First under Ish vaqti (owner, 30.10.2026);
 * it used to be the first tab of Sozlamalar.
 */
/** `embedded`: drawn inside Sozlamalar, which carries the heading. */
export function WorkHoursPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ['settings', 'work'],
    queryFn: () => api.get<WorkSettings>('/settings/work'),
  });

  const [hours, setHours] = useState(8);
  const [days, setDays] = useState<number[]>([]);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('18:00');
  const [grace, setGrace] = useState(10);
  const [seeded, setSeeded] = useState(false);

  const [attempted, setAttempted] = useState(false);
  // The work rules are read far more often than they are changed, and a stray
  // click used to be enough to change one. They are locked until somebody says
  // they mean to edit them, and the way out is Save or Cancel.
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (data && !seeded) {
      setHours(data.expected_hours_per_day);
      setDays(data.workdays);
      setStart(data.shift_start);
      setEnd(data.shift_end);
      setGrace(data.late_grace_minutes);
      setSeeded(true);
    }
  }, [data, seeded]);

  const saveM = useMutation({
    mutationFn: () =>
      api.patch<WorkSettings>('/settings/work', {
        expected_hours_per_day: hours,
        workdays: days,
        shift_start: start,
        shift_end: end,
        late_grace_minutes: grace,
      }),
    onSuccess: () => {
      setAttempted(false);
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: ['settings', 'work'] });
    },
  });

  const toggleDay = (d: number) =>
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));

  /** Put back what is stored and close the form. */
  const cancel = () => {
    if (data) {
      setHours(data.expected_hours_per_day);
      setDays(data.workdays);
      setStart(data.shift_start);
      setEnd(data.shift_end);
      setGrace(data.late_grace_minutes);
    }
    setAttempted(false);
    setEditing(false);
    saveM.reset();
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = t as any;
  const settingsValid =
    hours >= 1 &&
    hours <= 24 &&
    days.length > 0 &&
    grace >= 0 &&
    grace <= 180 &&
    !!start &&
    !!end &&
    start < end;
  const save = () => {
    setAttempted(true);
    if (!settingsValid) {
      const id = hours < 1 || hours > 24 ? 's-hours' : !days.length ? 's-workdays' : grace < 0 || grace > 180 ? 's-grace' : !start || start >= end ? 's-start' : 's-end';
      document.getElementById(id)?.focus();
      return;
    }
    saveM.mutate();
  };

  return (
    <div>
      {!embedded && <PageHeader title={t('nav.workHours')} />}
      {isLoading ? (
        <Card>
          <Spinner />
        </Card>
      ) : (
        <Card className="max-w-xl p-5">
          <div className="mb-5">
            <label className="field-label" htmlFor="s-hours">
              {t('settings.expectedHours')}
            </label>
            <input
              id="s-hours"
              type="number"
              min={1}
              max={24}
              className="input max-w-[120px]"
              value={hours}
              disabled={!editing}
              onChange={(e) => setHours(Number(e.target.value))}
            />
          </div>

          <div className="mb-5">
            <span id="s-workdays" tabIndex={-1} className="field-label">{t('settings.workdays')}</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {WEEKDAYS.map((d) => {
                const active = days.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDay(d)}
                    disabled={!editing}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:cursor-default ${
                      active
                        ? 'border-brand bg-brand-tint text-brand-dark'
                        : 'border-mist bg-white text-slate hover:bg-paper'
                    } ${editing ? '' : 'opacity-60'}`}
                  >
                    {tf(`weekdayShort.${WEEKDAY_KEY[d]}`)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mb-5">
            <label className="field-label" htmlFor="s-grace">
              {t('settings.lateGrace')}
            </label>
            <input
              id="s-grace"
              type="number"
              min={0}
              max={180}
              className="input max-w-[120px]"
              value={grace}
              disabled={!editing}
              onChange={(e) => setGrace(Number(e.target.value))}
            />
          </div>

          <div className="mb-5 grid grid-cols-2 gap-4">
            <div>
              <label className="field-label" htmlFor="s-start">
                {t('settings.shiftStart')}
              </label>
              <input
                id="s-start"
                type="time"
                className="input"
                value={start}
                disabled={!editing}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="s-end">
                {t('settings.shiftEnd')}
              </label>
              <input
                id="s-end"
                type="time"
                className="input"
                value={end}
                disabled={!editing}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>

          <ValidationNote show={attempted && !settingsValid} />

          {saveM.isError && (
            <div className="mb-4">
              <ErrorNote error={saveM.error} />
            </div>
          )}

          <div className="flex items-center gap-3">
            {editing ? (
              <>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={saveM.isPending}
                  onClick={save}
                >
                  {saveM.isPending ? t('common.saving') : t('common.saveChanges')}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={saveM.isPending}
                  onClick={cancel}
                >
                  {t('common.cancel')}
                </button>
              </>
            ) : (
              <button type="button" className="btn-ghost" onClick={() => setEditing(true)}>
                {t('common.edit')}
              </button>
            )}
            {saveM.isSuccess && !saveM.isPending && !editing && (
              <span className="text-sm font-medium text-[#15803d]">{t('settings.saved')}</span>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
