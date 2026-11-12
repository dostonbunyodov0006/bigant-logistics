import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { OrderPublic } from '@bigant/shared';
import { DataTable, EmptyState, type Column } from './ui';
import { StatusBadge } from './StatusBadge';
import { CarriedOverNote } from './ShiftCheck';
import { formatDateTime } from '../lib/format';

/** A clickable orders table reused by per-entity detail pages. */
export function OrderList({
  orders,
  emptyTitle,
  showDriver = true,
}: {
  orders: OrderPublic[];
  emptyTitle: string;
  showDriver?: boolean;
}) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  if (orders.length === 0) {
    return <EmptyState title={emptyTitle} />;
  }

  const columns: Column<OrderPublic>[] = [
    {
      key: 'client',
      header: t('orders.colClient'),
      render: (o) => <span className="font-medium text-ink">{o.client_name}</span>,
    },
    {
      key: 'status',
      header: t('orders.status'),
      render: (o) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={o.status} />
          <CarriedOverNote carried={o.carried_over} compact />
        </div>
      ),
    },
    ...(showDriver
      ? [
          {
            key: 'driver',
            header: t('orders.colDriver'),
            render: (o) => (
              <span className="text-slate">{o.assigned_driver_name ?? '—'}</span>
            ),
          } as Column<OrderPublic>,
        ]
      : []),
    {
      key: 'delivery',
      header: t('orders.colDelivery'),
      render: (o) => <span className="text-slate">{formatDateTime(o.delivery_datetime)}</span>,
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={orders}
      keyOf={(o) => o.id}
      onRowClick={(o) => navigate(`/orders/${o.id}`)}
    />
  );
}
