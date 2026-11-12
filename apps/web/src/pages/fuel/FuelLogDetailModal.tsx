import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FUEL_STATION_FENCE_RADIUS_M, type FuelLog } from '@bigant/shared';
import { api } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';
import { FenceMap } from '../../components/FenceMap';
import { Modal } from '../../components/Modal';
import { ErrorNote } from '../../components/ui';
import { ArithmeticLine, FlagTags, OutcomeChip, dayTime, metres, money, qty, useFuelLabels } from './fuelShared';
import { TZ } from '../../lib/tashkent';
import { safeHref } from '../../lib/safeHref';

/**
 * One fill-up, everything about it on one screen: the photo beside the map,
 * the numbers, what the driver said against what the fence found, and who
 * pays. Read-only: who pays is settled by the rules, not by a button here.
 */
export function FuelLogDetailModal({ log, onClose }: { log: FuelLog | null; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal open={!!log} onClose={onClose} title={log ? `${log.driver_name ?? '—'} · ${log.vehicle_plate ?? ''}` : ''} size="xl">
      {log && <Body log={log} onClose={onClose} />}
      <span className="sr-only">{t('fuel.detail.photo')}</span>
    </Modal>
  );
}

function Body({ log, onClose }: { log: FuelLog; onClose: () => void }) {
  const { t } = useTranslation();
  const L = useFuelLabels();
  const r = log.confirmed;
  const station = log.resolved_station;
  const canEdit = log.status === 'confirmed' && !log.settled_at;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3 text-sm text-slate">
        <span>{dayTime(log.captured_at)}</span>
        <span>·</span>
        <span>{L.fuel(log.fuel_type)}</span>
        <span>·</span>
        <span>{L.stationName(log)}</span>
        <span className="flex-1" />
        <OutcomeChip outcome={log.outcome} />
        <FlagTags flags={log.flags} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Left: the photo and the numbers off it. */}
        <div className="flex flex-col gap-3">
          <Eyebrow>{t('fuel.detail.photo')}</Eyebrow>
          <a href={safeHref(log.photo_url)} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg bg-[#2a2d33]">
            <img src={log.photo_url} alt="" className="block h-[300px] w-full object-cover" />
          </a>
          <a href={safeHref(log.photo_url)} target="_blank" rel="noreferrer" className="text-xs font-semibold text-brand">
            {t('fuel.detail.openPhoto')}
          </a>

          <Eyebrow>{t('fuel.detail.numbers')}</Eyebrow>
          {r ? (
            canEdit ? (
              <ReadingEditor log={log} unit={L.unit(log.fuel_type)} onSaved={onClose} />
            ) : (
              <div>
                <Row k={t('fuel.detail.total')} v={`${money(r.total_sum)} so'm`} mono />
                <Row k={t('fuel.detail.quantity')} v={`${qty(r.quantity)} ${L.unit(log.fuel_type)}`} mono />
                <Row k={t('fuel.detail.unitPrice')} v={`${money(r.unit_price_sum)} so'm / ${L.unit(log.fuel_type)}`} mono last />
                <div className="pt-2">
                  <ArithmeticLine log={log} />
                </div>
                <AiLine log={log} />
                <CorrectionLine log={log} />
              </div>
            )
          ) : (
            <div className="text-sm text-slate-light">—</div>
          )}
        </div>

        {/* Right: where the truck was, and who pays. */}
        <div className="flex flex-col gap-3">
          <Eyebrow>{t('fuel.detail.location')}</Eyebrow>
          {log.capture || log.tracked || station?.lat != null ? (
            <FenceMap
              pin={(log.resolved_station ?? log.selected_station)?.lat != null ? { lat: (log.resolved_station ?? log.selected_station)!.lat!, lng: (log.resolved_station ?? log.selected_station)!.lng! } : null}
              capture={log.capture}
              tracked={log.tracked}
              radiusM={FUEL_STATION_FENCE_RADIUS_M}
            />
          ) : (
            <div className="rounded-lg bg-paper p-4 text-sm text-slate">{t('fuel.detail.noPosition')}</div>
          )}
          <div>
            <Row k={t('fuel.detail.driverPicked')} v={log.selected_station?.name ?? t('fuel.street')} />
            <Row
              k={t('fuel.detail.actually')}
              v={
                log.outcome === 'matched'
                  ? t('fuel.detail.actuallyMatched', { d: log.distance_m != null ? metres(log.distance_m) : '' })
                  : log.outcome === 'other_station'
                    ? t('fuel.detail.actuallyOther', { name: station?.name ?? '—', d: log.distance_m != null ? metres(log.distance_m) : '' })
                    : log.outcome === 'mismatch'
                      ? t('fuel.detail.actuallyElsewhere', { d: log.distance_m != null ? metres(log.distance_m) : '?' })
                      : log.outcome === 'unlisted'
                        ? t('fuel.detail.actuallyUnlisted')
                        : t('fuel.detail.actuallyUnknown')
              }
              tone={log.outcome === 'matched' ? 'ok' : log.outcome === 'mismatch' ? 'bad' : undefined}
            />
            <Row
              k={t('fuel.detail.tracker')}
              v={
                log.tracked
                  ? `${new Date(log.tracked.at).toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })}${
                      log.tracking_gap_m != null ? ` · ${t('fuel.detail.trackerAway', { d: metres(log.tracking_gap_m) })}` : ''
                    }`
                  : t('fuel.detail.trackerNone')
              }
            />
            <Row k={t('fuel.detail.accuracy')} v={log.capture?.accuracy_m != null ? `± ${Math.round(log.capture.accuracy_m)} m` : '—'} mono last />
          </div>

          <Eyebrow>{t('fuel.detail.settlement')}</Eyebrow>
          <Settlement log={log} />
        </div>
      </div>

    </div>
  );
}

/**
 * The three numbers as fields, for the person with the photo beside them.
 * The product check runs as they type; Save records who corrected it and
 * keeps the driver's entry as the original. Saving a reading that adds up
 * also releases a held log to its default settlement.
 */
function ReadingEditor({ log, unit, onSaved }: { log: FuelLog; unit: string; onSaved: () => void }) {
  const { t } = useTranslation();
  const r = log.confirmed!;
  const [total, setTotal] = useState(String(r.total_sum));
  const [quantity, setQuantity] = useState(String(r.quantity));
  const [price, setPrice] = useState(String(r.unit_price_sum));
  // Read-only until Tahrirlash: saving as shown approves, saving after an
  // edit corrects — and the logs say which.
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    setNote(null);
    setEditing(false);
    setTotal(String(r.total_sum));
    setQuantity(String(r.quantity));
    setPrice(String(r.unit_price_sum));
  }, [r.total_sum, r.quantity, r.unit_price_sum]);

  const num = (v: string) => {
    const n = Number(v.replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const T = num(total);
  const Q = num(quantity);
  const P = num(price);
  const complete = T != null && Q != null && P != null;
  const product = complete ? Q * P : null;
  const holds = complete && Math.abs(product! - T) <= 1;

  // Any keystroke that changed a field — even a ".0" on the end — is the
  // office correcting the numbers; nothing typed is an approval.
  const typedOver =
    total !== String(r.total_sum) || quantity !== String(r.quantity) || price !== String(r.unit_price_sum);
  const [note, setNote] = useState<string | null>(null);
  const saveM = useMutation({
    mutationFn: () => api.patch<FuelLog>(`/fuel/logs/${log.id}/reading`, { total_sum: T, quantity: Q, unit_price_sum: P, corrected: typedOver }),
    onSuccess: () => {
      setNote(t('fuel.detail.saved'));
      void queryClient.invalidateQueries({ queryKey: ['fuel'] });
      // Done: the window closes a moment after saying so.
      setTimeout(onSaved, 700);
    },
  });
  // Always saves. Unchanged numbers are the office approving them as they
  // stand; the server does not count that as a correction.
  const save = () => {
    setNote(null);
    saveM.mutate();
  };

  const field = (id: string, label: string, value: string, set: (v: string) => void, suffix: string) => (
    <label htmlFor={id} className="flex items-center justify-between gap-3 border-b border-mist py-1.5 text-sm">
      <span className="text-slate">{label}</span>
      <span className="flex items-center gap-2">
        {editing ? (
          <input id={id} className="input w-36 text-right font-mono font-semibold" inputMode="decimal" value={value} onChange={(e) => set(e.target.value)} />
        ) : (
          <span id={id} className="w-36 px-3 py-2 text-right font-mono font-semibold">{value}</span>
        )}
        <span className="w-24 text-xs text-slate-light">{suffix}</span>
      </span>
    </label>
  );

  return (
    <div>
      {field('rd-total', t('fuel.detail.total'), total, setTotal, "so'm")}
      {field('rd-qty', t('fuel.detail.quantity'), quantity, setQuantity, unit)}
      {field('rd-price', t('fuel.detail.unitPrice'), price, setPrice, `so'm / ${unit}`)}
      <div className="flex items-center justify-between gap-3 pt-2">
        <div className={`text-xs font-semibold ${holds ? 'text-[#15803d]' : 'text-[#a15c07]'}`}>
          {complete
            ? holds
              ? t('fuel.detail.arithmeticOk', { q: qty(Q!), p: money(P!), t: money(product!) })
              : t('fuel.detail.arithmeticOff', { q: qty(Q!), p: money(P!), t: money(product!), entered: money(T!) })
            : '—'}
        </div>
        <div className="flex flex-none gap-2">
          <button
            type="button"
            className={
              editing
                ? 'btn-ghost'
                : 'rounded-lg bg-[#facc15] px-4 py-2 text-sm font-semibold text-[#422006] hover:bg-[#eab308] disabled:opacity-50'
            }
            disabled={saveM.isPending}
            onClick={() => {
              if (editing) {
                setTotal(String(r.total_sum));
                setQuantity(String(r.quantity));
                setPrice(String(r.unit_price_sum));
              }
              setEditing(!editing);
            }}
          >
            {editing ? t('fuel.detail.cancelEdit') : t('fuel.detail.edit')}
          </button>
          <button
            type="button"
            className={
              editing
                ? 'btn-primary'
                : 'rounded-lg bg-[#16a34a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#15803d] disabled:opacity-50'
            }
            disabled={!complete || saveM.isPending}
            onClick={save}
          >
            {editing ? t('fuel.detail.saveEdit') : t('fuel.detail.approve')}
          </button>
        </div>
      </div>
      {note && <p className="mt-1 text-right text-xs font-semibold text-[#15803d]">{note}</p>}
      {saveM.isError && <ErrorNote error={saveM.error} />}
      <AiLine log={log} />
      <CorrectionLine log={log} />
    </div>
  );
}

/** Who corrected the numbers and from what, when someone has. */
function CorrectionLine({ log }: { log: FuelLog }) {
  const { t } = useTranslation();
  if (!log.original || !log.reviewed_at) return null;
  const o = log.original;
  return (
    <div className="mt-1 text-xs text-slate-light">
      <span className="font-semibold text-slate">{t('fuel.detail.corrected', { name: log.reviewed_by_name ?? '—', date: dayTime(log.reviewed_at) })}:</span>{' '}
      <span className="font-mono line-through">{money(o.total_sum)} · {qty(o.quantity)} · {money(o.unit_price_sum)}</span>
    </div>
  );
}

/**
 * What the model read, against what the driver confirmed. Identical most of
 * the time; when they differ, the digit that changed is the interesting part
 * — for judging the model this month, and a driver's corrections forever.
 */
function AiLine({ log }: { log: FuelLog }) {
  const { t } = useTranslation();
  if (log.extracted_readable === null) {
    return <div className="mt-2 text-xs text-slate-light">{t('fuel.detail.aiNone')}</div>;
  }
  if (log.extracted_readable === false || !log.extracted) {
    return (
      <div className="mt-2 text-xs text-slate-light">
        {t('fuel.detail.aiUnreadable', { reason: log.extracted_reason ?? '—' })}
      </div>
    );
  }
  const e = log.extracted;
  const c = log.confirmed;
  const same = !!c && e.total_sum === c.total_sum && e.quantity === c.quantity && e.unit_price_sum === c.unit_price_sum;
  return (
    <div className="mt-2 text-xs text-slate-light">
      <span className="font-semibold text-slate">{t('fuel.detail.aiRead')}:</span>{' '}
      <span className="font-mono">{money(e.total_sum)} · {qty(e.quantity)} · {money(e.unit_price_sum)}</span>
      {' — '}
      <span className={same ? '' : 'font-semibold text-[#a15c07]'}>{same ? t('fuel.detail.aiSame') : t('fuel.detail.aiChanged')}</span>
    </div>
  );
}

function Settlement({ log }: { log: FuelLog }) {
  const { t } = useTranslation();
  if (!log.settlement) {
    return <div className="rounded-lg bg-[#fef6e7] px-4 py-3 text-sm font-medium text-[#a15c07]">{t('fuel.detail.settlementPending')}</div>;
  }
  const paid = log.settled_at ? ` · ${t('fuel.detail.settlementPaid', { date: dayTime(log.settled_at) })}` : '';
  const text =
    log.settlement === 'station_invoice'
      ? t('fuel.detail.settlementStation', { name: log.resolved_station?.name ?? '—' })
      : t('fuel.detail.settlementDriver');
  return (
    <div className={`rounded-lg px-4 py-3 text-sm font-medium ${log.settlement === 'station_invoice' ? 'bg-[#e6f6ec] text-[#15803d]' : 'bg-brand-tint text-brandDark'}`}>
      {text}
      {paid}
    </div>
  );
}

/**
 * The fence around the station, the photo's position, the tracker's position.
 * Drawn once per log: the circle is a 64-point polygon in metres, so it stays
 * 150 m at any zoom, and the two dots are plain markers.
 */

/** A GeoJSON polygon, typed structurally: the `geojson` types are maplibre's
 *  own dependency and not reachable from here under pnpm's strict layout. */




function Eyebrow({ children }: { children: string }) {
  return <div className="text-[11px] font-bold uppercase tracking-wider text-slate">{children}</div>;
}

function Row({ k, v, mono, tone, last }: { k: string; v: string; mono?: boolean; tone?: 'ok' | 'bad'; last?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 py-2 text-sm ${last ? '' : 'border-b border-mist'}`}>
      <span className="text-slate">{k}</span>
      <span className={`text-right font-semibold ${mono ? 'font-mono' : ''} ${tone === 'ok' ? 'text-[#15803d]' : tone === 'bad' ? 'text-[#dc2626]' : ''}`}>{v}</span>
    </div>
  );
}
