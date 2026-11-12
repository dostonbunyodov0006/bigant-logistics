import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import type { ServiceDueItem, ServiceVisit, ServiceVisitStatus } from '@bigant/shared';
import { money } from '../fuel/fuelShared';

/**
 * The service tabs' small shared vocabulary: how far a work is, what state a
 * visit is in, where it happened, who pays. The fuel page's number formats
 * and outcome chip are reused as they are — the fence is the same fence.
 */

export const km = (n: number) => Math.round(n).toLocaleString('ru-RU');

export function useServiceLabels() {
  const { t } = useTranslation();
  return {
    place: (v: ServiceVisit) => v.resolved_center?.name ?? v.selected_center?.name ?? t('service.street'),
    works: (v: ServiceVisit) => v.items.map((i) => i.name).join(' · '),
    origin: (v: ServiceVisit) => t(`service.origin.${v.origin}`) + (v.client_name ? ` · ${v.client_name}` : ''),
    remaining: (r: number | null) =>
      r == null ? t('service.due.unknown') : r < 0 ? t('service.due.overdueBy', { km: km(-r) }) : t('service.due.left', { km: km(r) }),
  };
}

/** Grey beyond range, amber inside 1 000 km, red once past. */
export function RemainingChip({ item }: { item: ServiceDueItem }) {
  const L = useServiceLabels();
  const r = item.remaining_km;
  const tone = r == null ? 'bg-[#eef1f5] text-slate' : r < 0 ? 'bg-[#fdeaea] text-[#dc2626]' : r <= 1000 ? 'bg-[#fef6e7] text-[#a15c07]' : 'bg-[#eef1f5] text-slate';
  return (
    <span className={clsx('inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', tone)}>
      {L.remaining(r)}
    </span>
  );
}

const STATUS_TONE: Record<ServiceVisitStatus, string> = {
  requested: 'bg-[#fef6e7] text-[#a15c07]',
  approved: 'bg-[#e6f6ec] text-[#15803d]',
  declined: 'bg-[#fdeaea] text-[#dc2626]',
  in_progress: 'bg-brand-tint text-brandDark',
  completed: 'bg-[#eef1f5] text-slate',
  cancelled: 'bg-[#eef1f5] text-slate-light',
};

export function StatusChip({ status }: { status: ServiceVisitStatus }) {
  const { t } = useTranslation();
  return (
    <span className={clsx('inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', STATUS_TONE[status])}>
      {t(`service.status.${status}`)}
    </span>
  );
}

/** Who pays, and whether they have — same words as the fuel ledger. */
export function VisitPayerCell({ visit }: { visit: ServiceVisit }) {
  const { t } = useTranslation();
  if (visit.status !== 'completed') return <span className="text-slate-light">—</span>;
  if (!visit.settlement) return <span className="text-slate-light">{t('fuel.payer.pending')}</span>;
  const label = t(`fuel.payer.${visit.settlement}`);
  if (visit.settled_at) {
    return (
      <span className="text-slate-light">
        {label} · {t('fuel.payer.paid')}
      </span>
    );
  }
  return <span className={clsx('font-semibold', visit.settlement === 'station_invoice' ? 'text-[#15803d]' : 'text-brandDark')}>{label}</span>;
}

export function ReceiptCell({ visit }: { visit: ServiceVisit }) {
  const { t } = useTranslation();
  if (visit.status !== 'completed') return <span className="text-slate-light">—</span>;
  if (visit.receipt_photo_url) return <span className="text-xs font-semibold text-[#15803d]">{t('service.receipt.yes')}</span>;
  if (visit.no_receipt) return <span className="text-xs font-semibold text-[#a15c07]">{t('service.receipt.none')}</span>;
  return <span className="text-slate-light">—</span>;
}

export const sum = (n: number | null) => (n == null ? '—' : money(n));

/** "2 kun oldin", "kecha", "bugun" — when something last happened. */
export function useAgo() {
  const { t } = useTranslation();
  return (iso: string | null): string => {
    if (!iso) return '';
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    if (days <= 0) return t('service.ago.today');
    if (days === 1) return t('service.ago.yesterday');
    return t('service.ago.days', { n: days });
  };
}
