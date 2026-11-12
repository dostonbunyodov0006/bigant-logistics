import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  CANCELLABLE_ORDER_STATUSES,
  type ConflictWarning,
  type DriverPublic,
  type OrderPublic,
} from '@bigant/shared';
import { api } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { useAuth } from '../auth/AuthContext';
import { OrderKindBadge, StatusBadge } from '../components/StatusBadge';
import { CarriedOverNote } from '../components/ShiftCheck';
import { Card, ErrorNote, Field, PageHeader, Spinner } from '../components/ui';
import { Modal } from '../components/Modal';
import { formatDateTime } from '../lib/format';

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-light">{label}</div>
      <div className={mono ? 'font-mono text-sm text-ink' : 'text-sm text-ink'}>{value}</div>
    </div>
  );
}

export function OrderDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  // Set when the order was created but the driver could not take it: the
  // order exists, and saying so here is what stops a second one being made.
  const assignError = (useLocation().state as { assignError?: string } | null)?.assignError ?? null;
  const { user } = useAuth();
  const { t } = useTranslation();
  const [driverId, setDriverId] = useState('');
  const [warnings, setWarnings] = useState<ConflictWarning[]>([]);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [assignAttempted, setAssignAttempted] = useState(false);
  const [cancelAttempted, setCancelAttempted] = useState(false);

  const orderQ = useQuery({
    queryKey: ['order', id],
    queryFn: () => api.get<OrderPublic>(`/orders/${id}`),
    // SSE keeps this live; the slow interval is only a reconnect/token-refresh safety net.
    refetchInterval: 60_000,
  });
  const order = orderQ.data;
  // A manager is a dispatcher, and handing an order to a driver is the job.
  // The server has always allowed it (roles.guard.ts treats manager as admin);
  // this screen did not, so the dispatcher had to ask the owner.
  const isStaff = user?.role === 'admin' || user?.role === 'manager';
  const showAssign = isStaff || user?.role === 'seller';

  const drivers = useQuery({
    queryKey: ['drivers'],
    queryFn: () => api.get<DriverPublic[]>('/drivers'),
    enabled: showAssign,
  });

  const assignM = useMutation({
    mutationFn: () =>
      api.post<{ warnings: ConflictWarning[] }>('/assignments', {
        order_id: id,
        driver_id: driverId,
      }),
    onSuccess: (res) => {
      setWarnings(res.warnings ?? []);
      setDriverId('');
      void queryClient.invalidateQueries({ queryKey: ['order', id] });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });

  const cancelM = useMutation({
    mutationFn: () => api.patch<OrderPublic>(`/orders/${id}/cancel`, { reason: cancelReason }),
    onSuccess: () => {
      setCancelOpen(false);
      setCancelReason('');
      void queryClient.invalidateQueries({ queryKey: ['order', id] });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });

  if (orderQ.isLoading) {
    return (
      <Card>
        <Spinner />
      </Card>
    );
  }
  if (!order) {
    return (
      <Card>
        <div className="p-6 text-sm text-slate">{t('orderDetail.notFound')}</div>
      </Card>
    );
  }

  const canManage =
    isStaff || (user?.role === 'seller' && order.created_by_seller_id === user.id);
  const canCancel =
    canManage && (CANCELLABLE_ORDER_STATUSES as readonly string[]).includes(order.status);
  const driverName = order.assigned_driver_id
    ? (order.assigned_driver_name ??
      drivers.data?.find((d) => d.id === order.assigned_driver_id)?.name ??
      t('orderDetail.assigned'))
    : t('orderDetail.unassigned');
  const assignable = order.status !== 'delivered' && order.status !== 'cancelled';

  return (
    <div className="mx-auto max-w-4xl">
      <button
        type="button"
        onClick={() => navigate('/orders')}
        className="mb-3 text-sm text-slate transition hover:text-ink"
      >
        ← {t('nav.orders')}
      </button>
      <PageHeader
        title={t('orderDetail.orderTitle', { client: order.client_name })}
        subtitle={order.client_name}
        actions={<div className="flex items-center gap-2"><OrderKindBadge kind={order.kind} /><StatusBadge status={order.status} /></div>}
      />
      {assignError && (
        <div className="mb-4">
          <ErrorNote error={new Error(assignError)} />
        </div>
      )}
      {order.carried_over && (
        <div className="mb-4">
          <CarriedOverNote carried={order.carried_over} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-slate-light">
            {t('orderDetail.products')}
          </h2>
          <div className="space-y-2">
            {order.items.map((it) => (
              <div
                key={it.id}
                className="flex items-center justify-between rounded-lg border border-mist px-3 py-2"
              >
                <div>
                  <div className="font-medium text-ink">
                    {it.product_name} <span className="font-mono text-slate">×{it.quantity}</span>
                  </div>
                  <div className="text-xs text-slate">{it.pickup_place_name}</div>
                </div>

              </div>
            ))}
          </div>
        </Card>

        <Card className="space-y-3 p-5">
          <Detail label={t('orderDetail.phone')} value={order.client_phone_number} mono />
          {order.client_address && (
            <Detail label={t('orderDetail.address')} value={order.client_address} />
          )}
          <Detail label={t('orderDetail.delivery')} value={formatDateTime(order.delivery_datetime)} />
          <Detail
            label={t('orderDetail.priority')}
            value={order.priority === 'urgent' ? t('priority.urgent') : t('priority.normal')}
          />
          {order.client_address_label && (
            <Detail label={t('createOrder.deliveryAddress')} value={order.client_address_label} />
          )}
          <Detail label={t('orderDetail.driver')} value={driverName} />
          {order.region_name && (
            <Detail label={t('orderDetail.region')} value={order.region_name} />
          )}
          {order.district_name && (
            <Detail label={t('orderDetail.district')} value={order.district_name} />
          )}
          {order.comment && <Detail label={t('orderDetail.comment')} value={order.comment} />}
          {order.cancellation_reason && (
            <Detail label={t('orderDetail.cancellationReason')} value={order.cancellation_reason} />
          )}
        </Card>
      </div>

      {showAssign && assignable && (
        <Card className="mt-4 space-y-3 p-5">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-slate-light">
            {order.assigned_driver_id ? t('orderDetail.reassignDriver') : t('orderDetail.assignDriver')}
          </h2>
          {assignM.isError && <ErrorNote error={assignM.error} />}
          {warnings.length > 0 && (
            <div className="rounded-lg bg-brand-tint px-3 py-2 text-sm text-brand-dark">
              ⚠ {warnings[0].message}
            </div>
          )}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Field
                label={t('orderDetail.driver')}
                error={assignAttempted && !driverId ? t('common.requiredField') : undefined}
              >
                <select
                  id="order-driver"
                  className="input"
                  value={driverId}
                  onChange={(e) => {
                    setDriverId(e.target.value);
                    if (e.target.value) setAssignAttempted(false);
                  }}
                >
                  <option value="">{t('orderDetail.selectDriver')}</option>
                  {drivers.data?.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} — {t(`driverStatus.${d.current_status}`)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <button
              type="button"
              className="btn-primary"
              disabled={assignM.isPending}
              onClick={() => {
                setAssignAttempted(true);
                if (!driverId) {
                  document.getElementById('order-driver')?.focus();
                  return;
                }
                assignM.mutate();
              }}
            >
              {assignM.isPending ? t('orderDetail.assigning') : t('orderDetail.assign')}
            </button>
          </div>
        </Card>
      )}

      {canCancel && (
        <div className="mt-4">
          <button
            type="button"
            className="btn-ghost text-[#dc2626]"
            onClick={() => {
              setCancelAttempted(false);
              setCancelOpen(true);
            }}
          >
            {t('orderDetail.cancelOrder')}
          </button>
        </div>
      )}

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title={t('orderDetail.cancelOrder')}>
        <div className="space-y-4">
          {cancelM.isError && <ErrorNote error={cancelM.error} />}
          <Field
            label={t('orderDetail.reason')}
            error={cancelAttempted && !cancelReason.trim() ? t('common.requiredField') : undefined}
          >
            <textarea
              id="cancel-order-reason"
              className="input"
              rows={3}
              value={cancelReason}
              onChange={(e) => {
                setCancelReason(e.target.value);
                if (e.target.value.trim()) setCancelAttempted(false);
              }}
              placeholder={t('orderDetail.cancelReasonPlaceholder')}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={cancelM.isPending}
              onClick={() => {
                setCancelAttempted(true);
                if (!cancelReason.trim()) {
                  document.getElementById('cancel-order-reason')?.focus();
                  return;
                }
                cancelM.mutate();
              }}
            >
              {cancelM.isPending ? t('orderDetail.cancelling') : t('orderDetail.cancelOrder')}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setCancelOpen(false)}>
              {t('orderDetail.keepOrder')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
