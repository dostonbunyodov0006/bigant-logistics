import { useState } from 'react';
import { useBoardBase } from '../lib/boardBase';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { VOZVRAT_CULPRITS, VOZVRAT_REASONS, type OrderPublic, type ReturnItemPublic } from '@bigant/shared';
import { api } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { safeHref } from '../lib/safeHref';
import { SupplierPlacePicker } from '../components/SupplierPlacePicker';

const CULPRIT_LABEL: Record<string, string> = {
  sotuvchi: 'Sotuvchi',
  mijoz: 'Mijoz',
  omborchi: 'Omborchi',
  haydovchi: 'Haydovchi',
};
const reasonText = (item: ReturnItemPublic) =>
  item.reason_code === 'x'
    ? (item.other_reason ?? '—')
    : (VOZVRAT_REASONS.find((r) => r.code === item.reason_code)?.text ?? item.reason_code);
const culpritOf = (item: ReturnItemPublic) =>
  item.culprit ?? VOZVRAT_REASONS.find((r) => r.code === item.reason_code)?.culprit ?? null;
const qty = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 3 });

/**
 * The driver's vozvrat, as the seller reads it: what came back, how much, in
 * what state, why, who the driver blames, and from where to where. The seller
 * confirms it, or writes his own account beside it — the driver carries on
 * with the return either way.
 */
export function SellerVozvratReviewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { orderId = '' } = useParams();
  const [ownOpen, setOwnOpen] = useState(false);
  const [culprit, setCulprit] = useState('');
  const [note, setNote] = useState('');
  const [attempted, setAttempted] = useState(false);
  // Where each returned stop's goods go: the seller's call, not the driver's.
  const [places, setPlaces] = useState<Record<string, string>>({});
  // Ta'minotchi: which supplier's place (owner, 12.11.2026).
  const [placeIds, setPlaceIds] = useState<Record<string, string>>({});
  const boardBase = useBoardBase();
  const back = () => navigate(boardBase);

  const orderQ = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => api.get<OrderPublic>(`/orders/${orderId}`),
  });
  const itemsQ = useQuery({
    queryKey: ['order', orderId, 'return-items'],
    queryFn: () => api.get<ReturnItemPublic[]>(`/orders/${orderId}/return/items`),
  });
  const confirmM = useMutation({
    mutationFn: (variant: { seller_culprit?: string; seller_note?: string }) =>
      api.patch(`/orders/${orderId}/return/items/confirm`, {
        ...variant,
        destinations: returning.map((src) => ({
          pickup_source_id: src.id,
          destination: placeOf(src),
          ...(placeOf(src) === 'supplier' && placeIdOf(src) ? { place_id: placeIdOf(src) } : {}),
        })),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-board'] });
      void queryClient.invalidateQueries({ queryKey: ['seller-queue'] });
      void queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      back();
    },
  });

  const order = orderQ.data;
  const items = itemsQ.data ?? [];
  const confirmed = !!order?.return_items_confirmed_at;
  const returning = (order?.pickup_sources ?? []).filter((src) => src.return_required);
  const placeOf = (src: { id: string; return_destination: string | null }) =>
    places[src.id] ?? src.return_destination ?? '';
  const placeIdOf = (src: { id: string; pickup_place_id: string; return_place?: { place_id?: string | null } | null }) =>
    placeIds[src.id] ?? src.return_place?.place_id ?? src.pickup_place_id;
  const placesChosen = returning.length > 0 && returning.every((src) => !!placeOf(src));
  const placeName = (d: string) => t(`sellerBoard.retDest_${d}` as 'sellerBoard.retDest_warehouse');

  const row = (k: string, v: React.ReactNode) => (
    <div className="flex gap-3 border-b border-hairline py-2.5 last:border-0">
      <span className="w-40 shrink-0 text-sm text-slate">{k}</span>
      <span className="min-w-0 flex-1 text-sm font-semibold text-paper">{v}</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-night px-4 py-5 text-paper">
      <div className="mx-auto max-w-3xl">
        <button type="button" onClick={back} className="mb-3 text-sm font-medium text-slate-light hover:text-paper">
          ← {t('common.back')}
        </button>
        <h1 className="font-display text-2xl font-bold">↩ Vozvrat so'rovi</h1>
        {order && (
          <p className="mt-1 text-sm text-slate-light">
            Zakaz #{order.order_number} · {order.client_name}
          </p>
        )}

        {orderQ.isLoading || itemsQ.isLoading ? (
          <p className="mt-6 text-sm text-slate">{t('common.loading')}</p>
        ) : !order ? (
          <p className="mt-6 text-sm text-slate">—</p>
        ) : (
          <>
            <section className="mt-5 rounded-xl border border-hairline bg-panel p-4">
              {row('Haydovchi', order.assigned_driver_name ?? '—')}
            </section>

            {!confirmed && (
              <section
                className={`mt-4 rounded-xl border-2 bg-panel p-4 ${
                  attempted && !placesChosen ? 'border-[#dc2626]' : 'border-[#f59e0b]'
                }`}
              >
                <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-[#fbbf24]">Tovar qayerga qaytariladi?</h2>
                {returning.map((src) => (
                  <div key={src.id} className="mb-3 last:mb-0">
                    {returning.length > 1 && <div className="mb-1.5 text-xs text-slate">{src.name} dan olingan yuk</div>}
                    <div className="grid grid-cols-3 gap-2">
                      {(['warehouse', 'store', 'supplier'] as const).map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setPlaces((cur) => ({ ...cur, [src.id]: d }))}
                          className={`rounded-lg border px-3 py-2.5 text-sm font-bold ${
                            placeOf(src) === d
                              ? 'border-brand bg-brand text-white'
                              : 'border-hairline bg-panel2 text-paper hover:border-brand/60'
                          }`}
                        >
                          {placeName(d)}
                        </button>
                      ))}
                    </div>
                    {placeOf(src) === 'supplier' && (
                      <SupplierPlacePicker
                        tone="dark"
                        value={placeIdOf(src)}
                        onPick={(id) => setPlaceIds((cur) => ({ ...cur, [src.id]: id }))}
                      />
                    )}
                  </div>
                ))}
                {attempted && !placesChosen && (
                  <p className="mt-2 text-sm font-semibold text-full">Qayerga qaytarilishini belgilang</p>
                )}
              </section>
            )}

            <section className="mt-4 rounded-xl border border-hairline bg-panel p-4">
              <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate">Qaytgan tovarlar</h2>
              <div className="flex flex-col gap-3">
                {items.map((item) => {
                  const who = culpritOf(item);
                  return (
                    <div key={item.id} className="flex gap-3 rounded-lg bg-panel2 p-3">
                      {/* Every photo of the product: the first large, the rest under it. */}
                      <div className="flex shrink-0 flex-col gap-1.5">
                        <a href={safeHref(item.photo_url)} target="_blank" rel="noreferrer">
                          <img src={item.photo_url} alt={item.name} className="h-24 w-24 rounded-md object-cover" />
                        </a>
                        {(item.photo_urls ?? []).length > 0 && (
                          <div className="flex w-24 flex-wrap gap-1">
                            {(item.photo_urls ?? []).map((u) => (
                              <a key={u} href={u} target="_blank" rel="noreferrer">
                                <img src={u} alt="" className="h-[30px] w-[30px] rounded object-cover" />
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-base font-bold">{item.name}</div>
                        <div className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                          <span className="text-slate">Soni</span>
                          <span className="font-semibold">
                            {qty(item.quantity)} {item.unit ?? ''}
                          </span>
                          <span className="text-slate">Holati</span>
                          <span className={`font-semibold ${item.condition === 'yaroqli' ? 'text-free' : 'text-full'}`}>
                            {item.condition === 'yaroqli' ? 'Yaroqli' : 'Yaroqsiz'}
                          </span>
                          <span className="text-slate">Sabab</span>
                          <span className="font-semibold">{reasonText(item)}</span>
                          <span className="text-slate">Haydovchi ko'rsatgan aybdor</span>
                          <span className="font-semibold text-[#fbbf24]">{who ? CULPRIT_LABEL[who] : '—'}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {items.length === 0 && <p className="text-sm text-slate">—</p>}
              </div>
            </section>

            {confirmed ? (
              <section className="mt-4 rounded-xl border border-free/50 bg-free-bg/20 p-4">
                <div className="text-sm font-bold text-free">✓ Tasdiqlangan</div>
                {(order.return_seller_culprit || order.return_seller_note) && (
                  <div className="mt-2 text-sm">
                    {order.return_seller_culprit && (
                      <div>
                        Sotuvchi varianti — aybdor: <b>{CULPRIT_LABEL[order.return_seller_culprit]}</b>
                      </div>
                    )}
                    {order.return_seller_note && <div className="mt-1 text-slate-light">{order.return_seller_note}</div>}
                  </div>
                )}
              </section>
            ) : ownOpen ? (
              <section className="mt-4 rounded-xl border-2 border-[#f59e0b] bg-panel p-4">
                <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-[#fbbf24]">O'z variantim</h2>
                <label className="mb-1 block text-xs uppercase tracking-wide text-slate" htmlFor="vr-culprit">
                  Aybdor
                </label>
                <select
                  id="vr-culprit"
                  className={`w-full rounded-lg border bg-panel2 px-3 py-2.5 text-sm text-paper outline-none focus:border-brand ${
                    attempted && !culprit ? 'border-[#dc2626]' : 'border-hairline'
                  }`}
                  value={culprit}
                  onChange={(e) => setCulprit(e.target.value)}
                >
                  <option value="">Aybdorni tanlang</option>
                  {VOZVRAT_CULPRITS.map((c) => (
                    <option key={c} value={c}>
                      {CULPRIT_LABEL[c]}
                    </option>
                  ))}
                </select>
                <label className="mb-1 mt-3 block text-xs uppercase tracking-wide text-slate" htmlFor="vr-note">
                  Izoh
                </label>
                <textarea
                  id="vr-note"
                  className={`min-h-24 w-full rounded-lg border bg-panel2 px-3 py-2.5 text-sm text-paper outline-none focus:border-brand ${
                    attempted && !note.trim() ? 'border-[#dc2626]' : 'border-hairline'
                  }`}
                  placeholder="Masalan: mijoz shu tovarni o'zi buyurtma qilgan, zakaz qog'ozi bor"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                  <button
                    type="button"
                    disabled={confirmM.isPending}
                    onClick={() => {
                      setAttempted(true);
                      if (!culprit || !note.trim() || !placesChosen) return;
                      confirmM.mutate({ seller_culprit: culprit, seller_note: note.trim() });
                    }}
                    className="rounded-xl bg-[#f59e0b] px-4 py-3 text-[15px] font-bold text-[#1c1206] disabled:opacity-50"
                  >
                    Saqlash
                  </button>
                  <button
                    type="button"
                    onClick={() => setOwnOpen(false)}
                    className="rounded-xl border border-hairline bg-panel2 px-4 py-3 text-[15px] font-bold text-paper"
                  >
                    Bekor
                  </button>
                </div>
              </section>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  disabled={confirmM.isPending}
                  onClick={() => {
                    setAttempted(true);
                    if (placesChosen) confirmM.mutate({});
                  }}
                  className="rounded-xl bg-[#16a34a] px-4 py-3.5 text-[15px] font-bold text-white hover:bg-[#15803d] disabled:opacity-50"
                >
                  ✓ Tasdiqlash
                </button>
                <button
                  type="button"
                  onClick={() => setOwnOpen(true)}
                  className="rounded-xl bg-[#facc15] px-4 py-3.5 text-[15px] font-bold text-[#422006] hover:bg-[#eab308]"
                >
                  ✎ O'z variantim
                </button>
              </div>
            )}
            {confirmM.isError && (
              <p className="mt-3 text-sm font-semibold text-full">Saqlab bo'lmadi. Qayta urinib ko'ring.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
