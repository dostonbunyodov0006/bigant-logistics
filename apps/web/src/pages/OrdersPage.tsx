import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  MAX_PAGE_SIZE,
  ORDER_STATUSES,
  type DriverPublic,
  type OrderPage,
  type OrderPublic,
  type UserPublic,
} from '@bigant/shared';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { OrderKindBadge, StatusBadge } from '../components/StatusBadge';
import { CarriedOverNote } from '../components/ShiftCheck';
import { Card, DataTable, EmptyState, PageHeader, Spinner, Tabs, type Column } from '../components/ui';
import { VozvratPage } from './VozvratPage';
import { Pager } from '../components/Pager';
import { formatDateTime } from '../lib/format';

const PAGE = 50;

export function OrdersPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useTranslation();
  const isAdminOrManager = user?.role === 'admin' || user?.role === 'manager';
  // Vozvratlar is a tab here, not a menu entry (owner, 02.11.2026): the pick is
  // in the address (?bolim=vozvrat) so a refresh or an old link keeps it.
  const [addr, setAddr] = useSearchParams();
  const bolim: 'orders' | 'vozvrat' = addr.get('bolim') === 'vozvrat' && isAdminOrManager ? 'vozvrat' : 'orders';

  // The dashboard's numbers open this list already filtered (owner, 06.11.2026).
  const [status, setStatus] = useState(() => addr.get('status') ?? '');
  const [clientPhone, setClientPhone] = useState('');
  const [deliveryDate, setDeliveryDate] = useState(() => addr.get('sana') ?? '');
  const [seller, setSeller] = useState('');
  const [driver, setDriver] = useState('');

  // One page at a time, from the server. The plain list stops at 100 rows and
  // said nothing about it, so a busy month simply hid its oldest orders.
  const [page, setPage] = useState(0);
  const params = new URLSearchParams();
  params.set('skip', String(page * PAGE));
  params.set('take', String(PAGE));
  if (status) params.set('status', status);
  if (clientPhone) params.set('client_phone', clientPhone);
  if (deliveryDate) params.set('delivery_date', deliveryDate);
  if (seller) params.set('seller_id', seller);
  if (driver) params.set('driver_id', driver);
  const qs = params.toString();

  const { data: pageData, isLoading } = useQuery({
    queryKey: ['orders', 'page', qs],
    queryFn: () => api.get<OrderPage>(`/orders/page?${qs}`),
    // SSE keeps this live; the slow interval is only a reconnect/token-refresh safety net.
    refetchInterval: 60_000,
  });
  const orders = pageData?.items ?? [];
  const pageCount = Math.ceil((pageData?.total ?? 0) / PAGE);

  // Filter option lists — only fetched for admin/manager (who can slice by anyone).
  const { data: sellers = [] } = useQuery({
    queryKey: ['users', 'seller'],
      // Reference dropdown: bounded explicitly. A fleet/roster past this size
      // needs a searchable picker rather than a <select>.
    queryFn: () => api.get<UserPublic[]>(`/users?role=seller&take=${MAX_PAGE_SIZE}`),
    enabled: isAdminOrManager,
  });
  const { data: drivers = [] } = useQuery({
    queryKey: ['drivers'],
    queryFn: () => api.get<DriverPublic[]>('/drivers'),
    enabled: isAdminOrManager,
  });

  const columns: Column<OrderPublic>[] = [
    {
      key: 'client',
      header: t('orders.colClient'),
      render: (o) => (
        <div>
          <div className="font-medium text-ink">{o.client_name}</div>
          <div className="font-mono text-xs text-slate-light">{o.client_phone_number}</div>
        </div>
      ),
    },
    ...(isAdminOrManager
      ? [
          {
            key: 'seller',
            header: t('orders.colSeller'),
            render: (o) =>
              o.created_by_seller_name ? (
                <span className="text-sm text-ink">{o.created_by_seller_name}</span>
              ) : (
                <span className="text-xs text-slate-light">—</span>
              ),
          } as Column<OrderPublic>,
        ]
      : []),
    {
      key: 'status',
      header: t('orders.status'),
      render: (o) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5"><OrderKindBadge kind={o.kind} /><StatusBadge status={o.status} /></span>
          <CarriedOverNote carried={o.carried_over} compact />
        </div>
      ),
    },
    {
      key: 'driver',
      header: t('orders.colDriver'),
      render: (o) =>
        o.assigned_driver_name ? (
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#dbeafe] text-xs font-semibold text-[#1d4ed8]">
              {o.assigned_driver_name.charAt(0).toUpperCase()}
            </span>
            <span className="text-sm text-ink">{o.assigned_driver_name}</span>
          </div>
        ) : (
          <span className="text-xs text-slate-light">{t('orderDetail.unassigned')}</span>
        ),
    },
    {
      key: 'priority',
      header: t('orders.colPriority'),
      render: (o) =>
        o.priority === 'urgent' ? (
          <span className="rounded-full bg-brand-tint px-2 py-0.5 text-xs font-medium text-brand-dark">
            {t('priority.urgent')}
          </span>
        ) : (
          <span className="text-xs text-slate-light">{t('priority.normal')}</span>
        ),
    },
    {
      key: 'items',
      header: t('orders.colItems'),
      // Distinct product lines (not summed quantity) — "Mahsulotlar" = number of products.
      render: (o) => <span className="font-mono text-slate">{o.items.length}</span>,
    },
    {
      key: 'delivery',
      header: t('orders.colDelivery'),
      render: (o) => <span className="text-slate">{formatDateTime(o.delivery_datetime)}</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('orders.title')}
        actions={
          bolim === 'vozvrat' ? (
            <Link to="/orders/new-vozvrat" className="btn-primary">
              {t('vozvratAdmin.newOrder')}
            </Link>
          ) : user?.role !== 'driver' ? (
            <button type="button" className="btn-primary" onClick={() => navigate('/orders/new')}>
              {t('orders.newOrder')}
            </button>
          ) : undefined
        }
      />
      {isAdminOrManager && (
        <Tabs<'orders' | 'vozvrat'>
          tabs={[
            { value: 'orders', label: t('orders.tabAll') },
            { value: 'vozvrat', label: t('nav.vozvrat') },
          ]}
          active={bolim}
          onChange={(k) => setAddr(k === 'orders' ? {} : { bolim: k }, { replace: true })}
        />
      )}
      {bolim === 'vozvrat' ? (
        <VozvratPage embedded />
      ) : (
        <>
      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="field-label" htmlFor="f-status">
              {t('orders.status')}
            </label>
            <select
              id="f-status"
              className="input"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(0);
              }}
            >
              <option value="">{t('orders.allStatuses')}</option>
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`orderStatus.${s}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="f-phone">
              {t('orders.clientPhone')}
            </label>
            <input
              id="f-phone"
              className="input"
              placeholder={t('orders.searchByPhone')}
              value={clientPhone}
              onChange={(e) => {
                setClientPhone(e.target.value);
                setPage(0);
              }}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="f-date">
              {t('orders.deliveryDate')}
            </label>
            <input
              id="f-date"
              type="date"
              className="input"
              value={deliveryDate}
              onChange={(e) => {
                setDeliveryDate(e.target.value);
                setPage(0);
              }}
            />
          </div>
          {isAdminOrManager && (
            <>
              <div>
                <label className="field-label" htmlFor="f-seller">
                  {t('orders.colSeller')}
                </label>
                <select
                  id="f-seller"
                  className="input"
                  value={seller}
                  onChange={(e) => {
                setSeller(e.target.value);
                setPage(0);
              }}
                >
                  <option value="">{t('orders.allSellers')}</option>
                  {sellers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="f-driver">
                  {t('orders.colDriver')}
                </label>
                <select
                  id="f-driver"
                  className="input"
                  value={driver}
                  onChange={(e) => {
                setDriver(e.target.value);
                setPage(0);
              }}
                >
                  <option value="">{t('orders.allDrivers')}</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
          <div className="flex items-end">
            <button
              type="button"
              className="btn-ghost w-full"
              onClick={() => {
                setStatus('');
                setClientPhone('');
                setDeliveryDate('');
                setSeller('');
                setDriver('');
                setPage(0);
              }}
            >
              {t('common.clearFilters')}
            </button>
          </div>
        </div>
      </Card>

      <Card>
        {isLoading ? (
          <Spinner />
        ) : orders.length === 0 ? (
          <EmptyState title={t('orders.noMatch')} hint={t('orders.noMatchHint')} />
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={orders}
              keyOf={(o) => o.id}
              onRowClick={(o) => navigate(`/orders/${o.id}`)}
            />
            <Pager page={page} count={pageCount} onPage={setPage} size="lg" />
          </>
        )}
      </Card>
        </>
      )}
    </div>
  );
}
