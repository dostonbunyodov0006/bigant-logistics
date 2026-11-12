import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ServiceDueItem } from '@bigant/shared';
import { api } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';
import { Modal } from '../../components/Modal';
import { ErrorNote } from '../../components/ui';
import { km } from './serviceShared';

/**
 * Where a lorry's schedule starts, for all its works in one go: the km at
 * which each was last done (owner, 30.10.2026 — it used to be one work at a
 * time, seven windows per lorry).
 */
export function VehicleBaselineModal({ works, onClose }: { works: ServiceDueItem[] | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!works) return;
    setValues(Object.fromEntries(works.map((w) => [w.reason_id, w.last_done_km != null ? String(w.last_done_km) : ''])));
  }, [works]);

  const parse = (v: string | undefined) => {
    const n = Number((v ?? '').replace(/\s/g, ''));
    return (v ?? '').trim() !== '' && Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
  };
  // Only what was typed or changed is sent; an empty box leaves that work as it is.
  const changed = (works ?? []).filter((w) => {
    const n = parse(values[w.reason_id]);
    return n != null && n !== w.last_done_km;
  });
  const bad = (works ?? []).some((w) => (values[w.reason_id] ?? '').trim() !== '' && parse(values[w.reason_id]) == null);

  const saveM = useMutation({
    mutationFn: async () => {
      for (const w of changed) {
        await api.put(`/service/vehicles/${w.vehicle_id}/baseline`, { reason_id: w.reason_id, last_done_km: parse(values[w.reason_id]) });
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['service'] });
      onClose();
    },
  });

  const first = works?.[0];
  return (
    <Modal open={!!works} onClose={onClose} title={first ? `${first.vehicle_model} · ${first.vehicle_plate}` : ''}>
      {works && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (changed.length > 0 && !bad) saveM.mutate();
          }}
          className="grid gap-3"
        >
          <div className="grid grid-cols-[1fr_140px_110px] items-center gap-x-3 gap-y-2 text-sm">
            <span className="text-xs font-semibold text-slate">{t('service.due.colWork')}</span>
            <span className="text-xs font-semibold text-slate">{t('service.baseline.lastDone')}</span>
            <span className="text-right text-xs font-semibold text-slate">{t('service.due.colDue')}</span>
            {works.map((w) => {
              const n = parse(values[w.reason_id]);
              return (
                <div key={w.reason_id} className="contents">
                  <span className="text-ink">
                    {w.reason_name} <span className="text-xs text-slate-light">· {km(w.interval_km)}</span>
                  </span>
                  <input
                    className="input font-mono"
                    inputMode="numeric"
                    value={values[w.reason_id] ?? ''}
                    placeholder={first?.current_km != null ? String(first.current_km) : ''}
                    onChange={(e) => setValues((cur) => ({ ...cur, [w.reason_id]: e.target.value }))}
                  />
                  <span className="text-right font-mono text-slate">{n != null ? km(n + w.interval_km) : '—'}</span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-end gap-2">
            {saveM.isError && <ErrorNote error={saveM.error} />}
            <button type="submit" className="btn-primary" disabled={changed.length === 0 || bad || saveM.isPending}>
              {t('fuel.stations.save')}
            </button>
            <button type="button" className="btn-ghost" onClick={onClose}>{t('fuel.stations.cancel')}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
