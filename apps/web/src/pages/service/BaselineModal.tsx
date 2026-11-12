import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ServiceDueItem } from '@bigant/shared';
import { api } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';
import { Modal } from '../../components/Modal';
import { ErrorNote, Field } from '../../components/ui';
import { km } from './serviceShared';

/**
 * The first cycle has no visit behind it: admin says at what km the work
 * was last done, and the schedule starts from there. After the first visit
 * through the app this is never needed again.
 */
export function BaselineModal({ item, onClose }: { item: ServiceDueItem | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  useEffect(() => {
    if (item) setValue(item.last_done_km != null ? String(item.last_done_km) : item.current_km != null ? String(item.current_km) : '');
  }, [item]);

  const n = Number(value.replace(/\s/g, ''));
  const valid = Number.isFinite(n) && n >= 0 && value.trim() !== '';

  const saveM = useMutation({
    mutationFn: () => api.put(`/service/vehicles/${item!.vehicle_id}/baseline`, { reason_id: item!.reason_id, last_done_km: Math.round(n) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['service'] });
      onClose();
    },
  });

  return (
    <Modal open={!!item} onClose={onClose} title={t('service.baseline.title')}>
      {item && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) saveM.mutate();
          }}
          className="grid gap-4"
        >
          <p className="text-sm text-slate">
            {t('service.baseline.body', { vehicle: `${item.vehicle_model} · ${item.vehicle_plate}`, work: item.reason_name, interval: km(item.interval_km) })}
          </p>
          <Field label={t('service.baseline.lastDone')}>
            <input id="bl-km" className="input font-mono" inputMode="numeric" required value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
          {valid && (
            <p className="text-xs text-slate">
              {t('service.baseline.preview', { due: km(n + item.interval_km), current: item.current_km != null ? km(item.current_km) : '—' })}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            {saveM.isError && <ErrorNote error={saveM.error} />}
            <button type="submit" className="btn-primary" disabled={!valid || saveM.isPending}>{t('fuel.stations.save')}</button>
            <button type="button" className="btn-ghost" onClick={onClose}>{t('fuel.stations.cancel')}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
