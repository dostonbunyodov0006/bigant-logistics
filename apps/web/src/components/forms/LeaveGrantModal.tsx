import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { LEAVE_TYPES, type DriverPublic, type LeaveRequestPublic, type LeaveType } from '@bigant/shared';
import { api } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';
import { Modal } from '../Modal';
import { ErrorNote, Field } from '../ui';

/**
 * The office writes a driver's leave down. He asked in person; the admin or
 * dispatcher picks him, the dates and the kind, and from then on his lorry
 * sits among the busy ones for those days.
 */
export function LeaveGrantModal({
  open,
  drivers,
  onClose,
}: {
  open: boolean;
  drivers: DriverPublic[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [driverId, setDriverId] = useState('');
  const [type, setType] = useState<LeaveType>('vacation');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDriverId('');
      setType('vacation');
      setStart('');
      setEnd('');
      setReason('');
      setLocalError(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () =>
      api.post<LeaveRequestPublic>('/leave', {
        driver_id: driverId,
        type,
        start_date: start,
        end_date: end,
        reason: reason.trim() || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['leave'] });
      void queryClient.invalidateQueries({ queryKey: ['seller-board'] });
      onClose();
    },
  });

  const submit = () => {
    setLocalError(null);
    if (!driverId) return setLocalError(t('leave.pickDriver'));
    if (!start || !end) return setLocalError(t('leave.pickDates'));
    if (end < start) return setLocalError(t('leave.endBeforeStart'));
    mutation.mutate();
  };

  return (
    <Modal open={open} onClose={onClose} title={t('leave.grantTitle')}>
      <div className="space-y-4">
        {mutation.isError && <ErrorNote error={mutation.error} />}
        {localError && <p className="text-sm text-[#dc2626]">{localError}</p>}
        <Field label={t('leave.colDriver')}>
          <select className="input" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
            <option value="">{t('leave.pickDriver')}</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </Field>
        <Field label={t('leave.colType')}>
          <select className="input" value={type} onChange={(e) => setType(e.target.value as LeaveType)}>
            {LEAVE_TYPES.map((lt) => (
              <option key={lt} value={lt}>{t(`leaveType.${lt}`)}</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('leave.startDate')}>
            <input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label={t('leave.endDate')}>
            <input type="date" className="input" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <Field label={t('leave.reasonOptional')}>
          <textarea rows={2} className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn-primary" disabled={mutation.isPending} onClick={submit}>
            {t('leave.grantSave')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
