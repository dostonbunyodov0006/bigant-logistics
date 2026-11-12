import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { FUEL_UNITS, type FuelLog, type FuelLogFlag, type FuelLogOutcome, type FuelType } from '@bigant/shared';
import { TZ, tkYmd } from '../../lib/tashkent';

/**
 * The small vocabulary every fuel tab shares: the outcome chip, the flag tag,
 * who-pays, and the number formats. One place so a `mismatch` looks the same
 * in the ledger, the queue and the detail.
 */

export const money = (n: number) => Math.round(n).toLocaleString('ru-RU');
export const qty = (n: number) =>
  n.toLocaleString('ru-RU', { maximumFractionDigits: 3 });
export const metres = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);
export const day = (iso: string) =>
  new Date(iso).toLocaleDateString('ru-RU', { timeZone: TZ, day: '2-digit', month: '2-digit' });
export const dayTime = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
// The day as the office lives it, not as UTC has it: toISOString() before
// 05:00 Tashkent answered with yesterday, so "this month to today" left out
// today's fill-ups and an early visit could not be booked for today.
export const ymd = (d: Date) =>
  tkYmd(d);

export function useFuelLabels() {
  const { t } = useTranslation();
  return {
    fuel: (f: FuelType) => t(`fuel.${f}`),
    unit: (f: FuelType) => (FUEL_UNITS[f] === 'nm3' ? t('fuel.unitNm3') : t('fuel.unitL')),
    stationName: (log: FuelLog) =>
      log.resolved_station?.name ?? log.selected_station?.name ?? t('fuel.street'),
  };
}

const OUTCOME_TONE: Record<FuelLogOutcome, string> = {
  matched: 'bg-[#e6f6ec] text-[#15803d]',
  other_station: 'bg-[#fef6e7] text-[#a15c07]',
  unlisted: 'bg-[#eef1f5] text-slate',
  mismatch: 'bg-[#fdeaea] text-[#dc2626]',
  unverified: 'bg-[#eef1f5] text-slate',
};

export function OutcomeChip({ outcome }: { outcome: FuelLogOutcome }) {
  const { t } = useTranslation();
  return (
    <span
      className={clsx(
        'inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold',
        OUTCOME_TONE[outcome],
      )}
    >
      {t(`fuel.outcome.${outcome}`)}
    </span>
  );
}

export function FlagTags({ flags }: { flags: FuelLogFlag[] }) {
  const { t } = useTranslation();
  if (flags.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <span
          key={f}
          className="rounded bg-[#fef6e7] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[#a15c07]"
        >
          {t(`fuel.flag.${f}`)}
        </span>
      ))}
    </span>
  );
}

/** Who pays, and whether they have. */
export function PayerCell({ log }: { log: FuelLog }) {
  const { t } = useTranslation();
  if (!log.settlement) {
    // Still in review, but the rule already says who pays: a station on our
    // list pays by invoice; off the list, the driver is paid back.
    const contracted = !!(log.resolved_station?.contracted || log.selected_station?.contracted);
    const expected =
      log.outcome === 'unlisted' || log.outcome === 'mismatch' || !contracted ? 'driver_reimbursement' : 'station_invoice';
    return (
      <span className={clsx('font-semibold', expected === 'station_invoice' ? 'text-[#15803d]' : 'text-brandDark')}>
        {t(`fuel.payer.${expected}`)}
        <span className="block text-[11px] font-normal text-[#a15c07]">{t('fuel.payer.inReview')}</span>
      </span>
    );
  }
  const label = t(`fuel.payer.${log.settlement}`);
  if (log.settled_at) {
    return (
      <span className="text-slate-light">
        {label} · {t('fuel.payer.paid')}
      </span>
    );
  }
  return (
    <span className={clsx('font-semibold', log.settlement === 'station_invoice' ? 'text-[#15803d]' : 'text-brandDark')}>
      {label}
    </span>
  );
}

/** quantity × unit price against the total, as the driver saw it on the phone. */
export function ArithmeticLine({ log }: { log: FuelLog }) {
  const { t } = useTranslation();
  const r = log.confirmed;
  if (!r) return null;
  const product = r.quantity * r.unit_price_sum;
  const holds = Math.abs(product - r.total_sum) <= 1;
  return (
    <div className={clsx('text-xs font-semibold', holds ? 'text-[#15803d]' : 'text-[#a15c07]')}>
      {holds
        ? t('fuel.detail.arithmeticOk', { q: qty(r.quantity), p: money(r.unit_price_sum), t: money(product) })
        : t('fuel.detail.arithmeticOff', {
            q: qty(r.quantity),
            p: money(r.unit_price_sum),
            t: money(product),
            entered: money(r.total_sum),
          })}
    </div>
  );
}

export function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv(filename: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const body = [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\n');
  // Byte-order mark so Excel opens the file as UTF-8 and the Uzbek names survive.
  const blob = new Blob(['\uFEFF', body], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
