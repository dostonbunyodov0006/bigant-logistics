import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { LeaveRequestPublic } from '@bigant/shared';
import { api } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';
import { Modal } from '../Modal';
import { ErrorNote, Field } from '../ui';

export function LeaveReviewModal({
  request,
  onClose,
}: {
  request: LeaveRequestPublic | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');

  useEffect(() => {
    if (request) setNote('');
  }, [request]);

  const mutation = useMutation({
    mutationFn: (status: 'approved' | 'rejected') =>
      api.patch<LeaveRequestPublic>(`/leave/${request!.id}/review`, {
        status,
        review_note: note.trim() || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['leave'] });
      onClose();
    },
  });

  return (
    <Modal open={!!request} onClose={onClose} title={t('leave.reviewTitle')}>
      {request && (
        <div className="space-y-4">
          {mutation.isError && <ErrorNote error={mutation.error} />}
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-slate">{t('leave.colDriver')}</span>
              <span className="font-medium text-ink">{request.driver_name ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate">{t('leave.colType')}</span>
              <span className="text-ink">{t(`leaveType.${request.type}`)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate">{t('leave.colPeriod')}</span>
              <span className="font-mono text-ink">
                {request.start_date} → {request.end_date}
              </span>
            </div>
            {request.reason && (
              <div className="flex justify-between gap-4">
                <span className="text-slate">{t('leave.colReason')}</span>
                <span className="text-right text-ink">{request.reason}</span>
              </div>
            )}
          </div>
          <Field label={t('leave.reviewNote')}>
            <textarea
              rows={2}
              className="input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('leave.reviewNotePlaceholder')}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="rounded-lg border border-[#dc2626] px-4 py-2 text-sm font-medium text-[#dc2626] hover:bg-[#fef2f2] disabled:opacity-50"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate('rejected')}
            >
              {t('leave.reject')}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate('approved')}
            >
              {t('leave.approve')}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
