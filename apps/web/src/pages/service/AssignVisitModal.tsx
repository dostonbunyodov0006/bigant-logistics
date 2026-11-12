import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ServiceCenter, ServiceDueItem, ServiceReason, ServiceVisit, VehiclePublic } from '@bigant/shared';
import { api } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';
import { Modal } from '../../components/Modal';
import { ErrorNote, Field } from '../../components/ui';
import { ymd } from '../fuel/fuelShared';
import { km } from './serviceShared';
import { addDays, fromTkInput, tkYmd } from '../../lib/tashkent';
import { useSearchOptions } from '../../lib/useSearchOptions';
import { SearchInput } from '../../components/SearchInput';

/**
 * "Servisga yuborish": admin books the visit. Opened from a due row the
 * vehicle and the work are already filled; opened bare (from the visits
 * tab) admin picks both. The driver gets a push and a card on their home
 * screen — approved from the start, nothing to accept.
 */
export function AssignVisitModal({ item, open: openBare, onClose }: { item: ServiceDueItem | null; open?: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const open = !!item || !!openBare;

  // Searched on the server: the 51st lorry is found as well as the first.
  const [vehicleSearch, setVehicleSearch] = useState('');
  const reasonsQ = useQuery({ queryKey: ['service', 'reasons', 'all'], queryFn: () => api.get<ServiceReason[]>('/service/reasons/all'), enabled: open });
  const dueQ = useQuery({ queryKey: ['service', 'due'], queryFn: () => api.get<ServiceDueItem[]>('/service/due'), enabled: open });
  const centersQ = useQuery({ queryKey: ['service', 'centers', 'all'], queryFn: () => api.get<ServiceCenter[]>('/service/centers/all'), enabled: open });

  const [vehicleId, setVehicleId] = useState('');
  const vehiclesQ = useSearchOptions<VehiclePublic>('/vehicles', vehicleSearch, vehicleId, open);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [custom, setCustom] = useState<string[]>([]);
  const [customDraft, setCustomDraft] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('09:00');
  const [centerId, setCenterId] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    setVehicleId(item?.vehicle_id ?? '');
    setPicked(new Set(item ? [item.reason_id] : []));
    setCustom([]);
    setCustomDraft('');
    setDate(addDays(tkYmd(), 1));
    setTime('09:00');
    setCenterId('');
    setNote('');
  }, [open, item]);

  // What is due on the chosen truck, to label the work chips.
  const dueFor = useMemo(() => new Map((dueQ.data ?? []).filter((d) => d.vehicle_id === vehicleId).map((d) => [d.reason_id, d.remaining_km])), [dueQ.data, vehicleId]);
  const vehicles = (vehiclesQ.data ?? []).filter((v) => v.assigned_driver_id);
  const reasons = (reasonsQ.data ?? []).filter((r) => r.active && (r.approved || picked.has(r.id)));

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const addCustom = () => {
    const name = customDraft.trim();
    if (!name) return;
    setCustom((c) => (c.includes(name) ? c : [...c, name]));
    setCustomDraft('');
  };

  const sendM = useMutation({
    mutationFn: () =>
      api.post<ServiceVisit>('/service/visits/assign', {
        vehicle_id: vehicleId,
        works: [...[...picked].map((id) => ({ reason_id: id })), ...custom.map((n) => ({ custom_name: n }))],
        scheduled_at: fromTkInput(`${date}T${time}`),
        center_id: centerId || null,
        note: note.trim() || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['service'] });
      onClose();
    },
  });

  const ready = vehicleId && (picked.size > 0 || custom.length > 0) && date && time;

  return (
    <Modal open={open} onClose={onClose} title={t('service.assign.title')} size="lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) sendM.mutate();
        }}
        className="grid gap-4"
      >
        <Field label={t('service.assign.vehicle')}>
          {!item && (
            <div className="mb-2">
              <SearchInput value={vehicleSearch} onChange={setVehicleSearch} placeholder={t('vehicles.search')} />
            </div>
          )}
          <select id="as-veh" className="input" required value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} disabled={!!item}>
            <option value="">—</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.model} · {v.plate_number} · {v.assigned_driver_name}
                {v.current_km != null ? ` · ${km(v.current_km)} km` : ''}
              </option>
            ))}
          </select>
        </Field>

        <div>
          <div className="field-label">{t('service.assign.works')}</div>
          <div className="flex flex-wrap gap-2">
            {reasons.map((r) => {
              const on = picked.has(r.id);
              const left = dueFor.get(r.id);
              return (
                <label
                  key={r.id}
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold ${on ? 'border-brand bg-brand-tint text-brandDark' : 'border-mist text-graphite'}`}
                >
                  <input type="checkbox" className="accent-brand" checked={on} onChange={() => toggle(r.id)} />
                  {r.name}
                  {left != null && (
                    <span className={`font-medium ${left < 0 ? 'text-[#dc2626]' : left <= 1000 ? 'text-[#a15c07]' : 'text-slate'}`}>
                      · {left < 0 ? t('service.due.overdueBy', { km: km(-left) }) : t('service.due.left', { km: km(left) })}
                    </span>
                  )}
                </label>
              );
            })}
            {custom.map((n) => (
              <button key={n} type="button" onClick={() => setCustom((c) => c.filter((x) => x !== n))} className="inline-flex items-center gap-2 rounded-lg border border-brand bg-brand-tint px-3 py-2 text-sm font-semibold text-brandDark">
                {n} <span aria-hidden>×</span>
              </button>
            ))}
            <span className="inline-flex items-center gap-1 rounded-lg border border-dashed border-mist px-2 py-1">
              <input
                className="w-40 bg-transparent px-1 text-sm outline-none"
                placeholder={t('service.assign.otherPlaceholder')}
                value={customDraft}
                onChange={(e) => setCustomDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addCustom();
                  }
                }}
                aria-label={t('service.assign.other')}
              />
              <button type="button" className="text-sm font-semibold text-brandDark" onClick={addCustom}>
                +
              </button>
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('service.assign.date')}>
            <input id="as-date" type="date" className="input" required min={ymd(new Date())} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={t('service.assign.time')}>
            <input id="as-time" type="time" className="input" required value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>

        <Field label={t('service.assign.center')}>
          <select id="as-center" className="input" value={centerId} onChange={(e) => setCenterId(e.target.value)}>
            <option value="">{t('service.assign.driverPicks')}</option>
            {centersQ.data?.filter((c) => c.active).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>

        <Field label={t('service.assign.note')}>
          <input id="as-note" className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        <div className="-mx-5 -mb-5 flex flex-wrap items-center gap-2 border-t border-mist bg-paper px-5 py-3">
          <span className="text-xs text-slate">{t('service.assign.footer')}</span>
          <span className="flex-1" />
          {sendM.isError && <ErrorNote error={sendM.error} />}
          <button type="submit" className="btn-primary" disabled={!ready || sendM.isPending}>{t('service.assign.send')}</button>
          <button type="button" className="btn-ghost" onClick={onClose}>{t('fuel.stations.cancel')}</button>
        </div>
      </form>
    </Modal>
  );
}
