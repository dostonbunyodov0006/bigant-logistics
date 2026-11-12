import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { WorkLogPublic } from '@bigant/shared';
import { api } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';
import { Modal } from '../Modal';
import { ErrorNote, Field } from '../ui';
import { fromTkInput, tkInput } from '../../lib/tashkent';

/** ISO → the "YYYY-MM-DDTHH:mm" a datetime-local input shows, in Tashkent. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return tkInput(d);
}

/**
 * Staff fixing a shift's times: a forgotten clock-out, or one the system
 * closed at the wrong time. For an open shift, setting the end closes it.
 * The note is required and shown on the shift afterwards.
 */
export function WorkLogCorrectModal({
  log,
  driverId,
  onClose,
}: {
  log: WorkLogPublic | null;
  driverId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!log) return;
    setStart(toLocalInput(log.clock_in_at));
    setEnd(toLocalInput(log.clock_out_at));
    setNote('');
  }, [log]);

  const mutation = useMutation({
    mutationFn: () => {
      const startIso = fromTkInput(start);
      const endIso = end ? fromTkInput(end) : null;
      return api.patch<WorkLogPublic>(`/drivers/${driverId}/work-logs/${log!.id}`, {
        ...(startIso !== log!.clock_in_at ? { clock_in_at: startIso } : {}),
        ...(endIso && endIso !== log!.clock_out_at ? { clock_out_at: endIso } : {}),
        note: note.trim(),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['driver', driverId] });
      void queryClient.invalidateQueries({ queryKey: ['drivers', 'shift-alerts'] });
      void queryClient.invalidateQueries({ queryKey: ['attendance'] });
      onClose();
    },
  });

  const open = !!log;
  const changed =
    !!log &&
    ((!!start && fromTkInput(start) !== log.clock_in_at) ||
      (!!end && fromTkInput(end) !== log.clock_out_at));
  const ready = changed && !!start && note.trim().length > 0;

  return (
    <Modal open={open} onClose={onClose} title={t('shiftFix.title')}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) mutation.mutate();
        }}
        className="space-y-4"
        noValidate
      >
        {mutation.isError && <ErrorNote error={mutation.error} />}
        {log && !log.clock_out_at && (
          <p className="rounded-lg bg-[#fef6e7] px-3 py-2 text-sm text-[#7c4a03]">
            {t('shiftFix.openHint')}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('shiftFix.start')}>
            <input
              type="datetime-local"
              className="input"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </Field>
          <Field label={t('shiftFix.end')}>
            <input
              type="datetime-local"
              className="input"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </Field>
        </div>
        <Field label={t('shiftFix.note')}>
          <textarea
            className="input min-h-[72px]"
            value={note}
            maxLength={500}
            placeholder={t('shiftFix.notePlaceholder')}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="submit" className="btn-primary" disabled={!ready || mutation.isPending}>
            {mutation.isPending ? t('common.saving') : t('shiftFix.save')}
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
