import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ClientPublic, OrderPage, OrderStats } from '@bigant/shared';
import { api } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { useAuth } from '../auth/AuthContext';
import { PageHeader, Spinner } from '../components/ui';
import { ItemActions } from '../components/ItemActions';
import { ClientFormModal } from '../components/forms/ClientFormModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { StatsStrip } from '../components/StatsStrip';
import { OrderList } from '../components/OrderList';
import { ClientAddressesCard } from '../components/ClientAddressesCard';
import { Pager } from '../components/Pager';

const ORDERS_PAGE = 20;

export function ClientDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user } = useAuth();
  // Deleting a client is admin/manager work on the server too.
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const clientQ = useQuery({
    queryKey: ['client', id],
    queryFn: () => api.get<ClientPublic>(`/clients/${id}`),
  });
  const statsQ = useQuery({
    queryKey: ['orders', 'stats', 'client', id],
    queryFn: () => api.get<OrderStats>(`/orders/stats?client_id=${id}`),
    // SSE keeps this live; the slow interval is only a reconnect/token-refresh safety net.
    refetchInterval: 60_000,
  });
  // Page by page: a busy client used to stop at the first hundred orders.
  const [orderPage, setOrderPage] = useState(0);
  const ordersQ = useQuery({
    queryKey: ['orders', 'page', 'client', id, orderPage],
    queryFn: () =>
      api.get<OrderPage>(`/orders/page?client_id=${id}&skip=${orderPage * ORDERS_PAGE}&take=${ORDERS_PAGE}`),
    placeholderData: (prev) => prev,
    // SSE keeps this live; the slow interval is only a reconnect/token-refresh safety net.
    refetchInterval: 60_000,
  });

  const client = clientQ.data;

  const deleteM = useMutation({
    mutationFn: () => api.del(`/clients/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['clients'] });
      navigate('/clients', { replace: true });
    },
  });

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate('/clients')}
        className="mb-3 text-sm font-medium text-slate hover:text-ink"
      >
        ← {t('common.back')}
      </button>

      <PageHeader
        title={client?.name ?? '…'}
        subtitle={client?.phone_number}
        actions={
          client && isAdmin ? (
            <ItemActions onEdit={() => setEditOpen(true)} onDelete={() => setDeleteOpen(true)} />
          ) : undefined
        }
      />

      {client?.address ? (
        <p className="-mt-3 mb-2 text-sm text-slate">{client.address}</p>
      ) : null}
      {client ? (
        <p className="mb-5 text-sm text-slate">
          {t('clients.colSeller')}:{' '}
          {client.seller_name ? (
            <b className="text-ink">{client.seller_name}</b>
          ) : (
            <span className="rounded bg-[#fef6e7] px-2 py-0.5 text-xs font-semibold text-[#a15c07]">{t('clients.sellerNone')}</span>
          )}
        </p>
      ) : null}

      <div className="mb-6">
        <StatsStrip stats={statsQ.data} />
      </div>

      <div className="mb-6">
        <ClientAddressesCard clientId={id} />
      </div>

      <h2 className="mb-3 font-display text-lg font-semibold">{t('orders.title')}</h2>
      {ordersQ.isLoading ? (
        <Spinner />
      ) : (
        <>
          <OrderList orders={ordersQ.data?.items ?? []} emptyTitle={t('orders.noMatch')} />
          <Pager
            page={orderPage}
            count={Math.max(1, Math.ceil((ordersQ.data?.total ?? 0) / ORDERS_PAGE))}
            onPage={setOrderPage}
            size="lg"
          />
        </>
      )}

      <ClientFormModal
        open={editOpen}
        editing={client ?? null}
        onClose={() => setEditOpen(false)}
      />
      <ConfirmDialog
        open={deleteOpen}
        title={t('clients.deleteTitle')}
        message={t('clients.deleteMessage', { name: client?.name ?? '' })}
        pending={deleteM.isPending}
        error={deleteM.isError ? deleteM.error : undefined}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => deleteM.mutate()}
      />
    </div>
  );
}
