import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { CompanyJobOption } from '@bigant/shared';
import { api, ApiError } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';

const OPTIONS_KEY = ['company-job-options'];

/**
 * "Ishxona ishi bilan" (owner, 12.11.2026): an admin or the dispatcher sends
 * the lorry on a company errand. Two fields, large: "Nima ish bilan?" picked
 * from a list the office keeps (added with "+ Yangi joy qo'shish", removed with
 * the bin beside each), and how many hours.
 */
export function CompanyJobForm({
  vehicleId,
  onDone,
  onBack,
}: {
  vehicleId: string;
  onDone: () => void;
  onBack: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const [hours, setHours] = useState('');
  const [tried, setTried] = useState(false);

  const optionsQ = useQuery({
    queryKey: OPTIONS_KEY,
    queryFn: () => api.get<CompanyJobOption[]>('/seller/company-job-options'),
  });
  const options = optionsQ.data ?? [];
  const addM = useMutation({
    mutationFn: (name: string) => api.post<CompanyJobOption>('/seller/company-job-options', { name }),
    onSuccess: (o) => {
      void queryClient.invalidateQueries({ queryKey: OPTIONS_KEY });
      setPicked(o.name);
      setAdding(false);
      setNewName('');
    },
  });
  const removeM = useMutation({
    mutationFn: (id: string) => api.del(`/seller/company-job-options/${id}`),
    onSuccess: (_r, id) => {
      const gone = options.find((o) => o.id === id);
      if (gone && gone.name === picked) setPicked(null);
      setRemoving(null);
      void queryClient.invalidateQueries({ queryKey: OPTIONS_KEY });
    },
  });

  const minutes = hours.trim() ? Math.round(Number(hours.replace(',', '.')) * 60) : NaN;
  const hoursOk = Number.isFinite(minutes) && minutes >= 30 && minutes <= 720;
  const sendM = useMutation({
    mutationFn: () => api.post(`/seller/vehicles/${vehicleId}/company-job`, { tasks: [picked], minutes }),
    onSuccess: onDone,
  });
  const err =
    sendM.error instanceof ApiError && sendM.error.message === 'vehicle_busy'
      ? "Haydovchi hozir zakaz tashiyapti — u bo'shagach yuboring."
      : sendM.error instanceof ApiError && sendM.error.message === 'vehicle_company_job'
        ? 'Bu mashina allaqachon ishxona ishida.'
        : sendM.isError
          ? "Saqlanmadi — qayta urinib ko'ring."
          : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="mb-2.5 text-lg font-bold text-paper">Nima ish bilan?</div>
        <div
          className={`overflow-hidden rounded-xl border bg-panel2 ${tried && !picked ? 'border-[#dc2626]' : 'border-hairline'}`}
        >
          {optionsQ.isLoading ? (
            <div className="px-4 py-4 text-base text-slate">…</div>
          ) : options.length === 0 && !adding ? (
            <div className="px-4 py-4 text-base text-slate">Ro'yxat bo'sh — pastdan yangi joy qo'shing</div>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              {options.map((o) => (
                <div
                  key={o.id}
                  className={`flex items-center gap-3 border-b border-hairline px-4 last:border-0 ${
                    picked === o.name ? 'bg-brand/15' : ''
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setPicked(o.name)}
                    className="flex min-h-[52px] flex-1 items-center gap-3 text-left text-lg text-paper"
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                        picked === o.name ? 'border-brand' : 'border-slate'
                      }`}
                    >
                      {picked === o.name && <span className="h-2.5 w-2.5 rounded-full bg-brand" />}
                    </span>
                    <span className={picked === o.name ? 'font-bold' : ''}>{o.name}</span>
                  </button>
                  {removing === o.id ? (
                    <span className="flex shrink-0 items-center gap-2 text-sm">
                      <span className="text-slate-light">O'chirilsinmi?</span>
                      <button
                        type="button"
                        disabled={removeM.isPending}
                        onClick={() => removeM.mutate(o.id)}
                        className="rounded-md bg-[#dc2626] px-2.5 py-1 font-bold text-white"
                      >
                        Ha
                      </button>
                      <button type="button" onClick={() => setRemoving(null)} className="rounded-md border border-hairline px-2.5 py-1 font-bold text-paper">
                        Yo'q
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setRemoving(o.id)}
                      aria-label={`${o.name} — o'chirish`}
                      title="O'chirish"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate hover:bg-[#dc2626]/10 hover:text-[#f87171]"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        {adding ? (
          <div className="mt-2.5 flex gap-2">
            <input
              value={newName}
              autoFocus
              maxLength={200}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newName.trim()) addM.mutate(newName.trim());
              }}
              placeholder="Masalan: Bankka hujjat olib borish"
              className="min-w-0 flex-1 rounded-xl border border-hairline bg-panel2 px-4 py-3 text-lg text-paper outline-none placeholder:text-slate focus:border-brand"
            />
            <button
              type="button"
              disabled={!newName.trim() || addM.isPending}
              onClick={() => addM.mutate(newName.trim())}
              className="rounded-xl bg-brand px-5 text-base font-bold text-white disabled:opacity-50"
            >
              Qo'shish
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setNewName('');
              }}
              className="rounded-xl border border-hairline px-4 text-base font-bold text-paper"
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-2.5 w-full rounded-xl border border-dashed border-brand/60 py-3 text-base font-bold text-brand hover:bg-brand/10"
          >
            + Yangi joy qo'shish
          </button>
        )}
        {addM.isError && <div className="mt-2 text-sm font-semibold text-[#f87171]">Qo'shilmadi — qayta urinib ko'ring.</div>}
      </div>

      <div>
        <label htmlFor="cj-hours" className="mb-2.5 block text-lg font-bold text-paper">
          Necha soatga band bo'ladi?
        </label>
        <div className="flex items-center gap-3">
          <input
            id="cj-hours"
            value={hours}
            onChange={(e) => setHours(e.target.value.replace(/[^\d.,]/g, ''))}
            inputMode="decimal"
            placeholder="Masalan: 2"
            className={`w-40 rounded-xl border bg-panel2 px-4 py-3 text-xl font-bold text-paper outline-none placeholder:text-base placeholder:font-normal placeholder:text-slate focus:border-brand ${
              tried && !hoursOk ? 'border-[#dc2626]' : 'border-hairline'
            }`}
          />
          <span className="text-lg text-slate-light">soat</span>
        </div>
        {tried && !hoursOk && (
          <div className="mt-2 text-sm font-semibold text-[#f87171]">Soatni yozing: 0.5 dan 12 gacha</div>
        )}
      </div>

      {err && (
        <div className="rounded-lg border border-[#dc2626]/50 bg-[#dc2626]/10 px-4 py-3 text-sm font-semibold text-[#f87171]">{err}</div>
      )}

      <div className="flex gap-3">
        <button type="button" onClick={onBack} className="flex-1 rounded-xl border border-hairline py-4 text-base font-bold text-paper">
          Orqaga
        </button>
        <button
          type="button"
          disabled={sendM.isPending}
          onClick={() => {
            setTried(true);
            if (picked && hoursOk) sendM.mutate();
          }}
          className="flex-[2] rounded-xl bg-brand py-4 text-lg font-bold text-white disabled:opacity-60"
        >
          🏢 Yuborish
        </button>
      </div>
    </div>
  );
}
