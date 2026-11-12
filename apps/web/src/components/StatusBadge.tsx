import { useTranslation } from 'react-i18next';
import type { DriverStatus, OrderKind, OrderStatus } from '@bigant/shared';

interface Tone {
  bg: string;
  fg: string;
}

// Colour tones only — the human label comes from i18n (orderStatus.* / driverStatus.*).
export const ORDER_STATUS_TONE: Record<OrderStatus, Tone> = {
  created: { bg: '#eef1f5', fg: '#5b6470' },
  awaiting_details: { bg: '#fef6e7', fg: '#a15c07' },
  assigned_to_driver: { bg: '#e7effe', fg: '#1d4ed8' },
  driver_accepted: { bg: '#e3f0ff', fg: '#2563eb' },
  collecting_items: { bg: '#fdf0e6', fg: '#b94e06' },
  items_collected: { bg: '#fef6e7', fg: '#a15c07' },
  on_the_way: { bg: '#efe9fe', fg: '#6d28d9' },
  arrived_at_customer: { bg: '#e8e2fb', fg: '#5b21b6' },
  delivered: { bg: '#e6f6ec', fg: '#15803d' },
  returning: { bg: '#fdeede', fg: '#b45309' },
  returned: { bg: '#eceff3', fg: '#64748b' },
  cancelled: { bg: '#f0f1f3', fg: '#8a93a0' },
  problem: { bg: '#fdeaea', fg: '#dc2626' },
};

const DRIVER_STATUS_TONE: Record<DriverStatus, Tone> = {
  available: { bg: '#e6f6ec', fg: '#15803d' },
  busy: { bg: '#fdf0e6', fg: '#b94e06' },
  on_delivery: { bg: '#efe9fe', fg: '#6d28d9' },
  offline: { bg: '#f0f1f3', fg: '#8a93a0' },
};

function Pill({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-xs font-medium"
      style={{ backgroundColor: tone.bg, color: tone.fg }}
    >
      {label}
    </span>
  );
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  const { t } = useTranslation();
  return <Pill tone={ORDER_STATUS_TONE[status] ?? ORDER_STATUS_TONE.created} label={t(`orderStatus.${status}`)} />;
}

export function DriverStatusBadge({ status }: { status: DriverStatus }) {
  const { t } = useTranslation();
  return (
    <Pill tone={DRIVER_STATUS_TONE[status] ?? DRIVER_STATUS_TONE.offline} label={t(`driverStatus.${status}`)} />
  );
}

/** "Vozvrat" next to the status of an order that fetches goods back; nothing for a delivery. */
export function OrderKindBadge({ kind }: { kind: OrderKind }) {
  const { t } = useTranslation();
  if (kind !== 'vozvrat') return null;
  return (
    <span className="inline-flex items-center rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-semibold text-purple-800">
      {t('orders.kindVozvrat')}
    </span>
  );
}
