import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { OrderPublic, OrderStats, UserPublic } from '@bigant/shared';
import { api } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { ErrorNote, PageHeader, Spinner } from '../components/ui';
import { StatsStrip } from '../components/StatsStrip';
import { OrderList } from '../components/OrderList';
import { ItemActions } from '../components/ItemActions';
import { UserFormModal } from '../components/forms/UserFormModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAuth } from '../auth/AuthContext';

export function SellerDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  // Editing and deactivating the account moved here off the staff list.
  const [editOpen, setEditOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const isAdmin = useAuth().user?.role === 'admin';

  const sellerQ = useQuery({
    queryKey: ['user', id],
    queryFn: () => api.get<UserPublic>(`/users/${id}`),
  });
  const statsQ = useQuery({
    queryKey: ['orders', 'stats', 'seller', id],
    queryFn: () => api.get<OrderStats>(`/orders/stats?seller_id=${id}`),
    // SSE keeps this live; the slow interval is only a reconnect/token-refresh safety net.
    refetchInterval: 60_000,
  });
  const ordersQ = useQuery({
    queryKey: ['orders', 'seller', id],
    queryFn: () => api.get<OrderPublic[]>(`/orders?seller_id=${id}`),
    // SSE keeps this live; the slow interval is only a reconnect/token-refresh safety net.
    refetchInterval: 60_000,
  });

  const seller = sellerQ.data;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['users'] });
    void queryClient.invalidateQueries({ queryKey: ['user', id] });
  };
  // Deactivating keeps the account and its order history; it only stops the
  // login. Nothing here deletes a person.
  const deactivateM = useMutation({
    mutationFn: () => api.del(`/users/${id}`),
    onSuccess: () => {
      invalidate();
      setDeactivateOpen(false);
    },
  });
  const activateM = useMutation({
    mutationFn: () => api.patch(`/users/${id}`, { status: 'active' }),
    onSuccess: invalidate,
  });

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate('/staff')}
        className="mb-3 text-sm font-medium text-slate hover:text-ink"
      >
        ← {t('common.back')}
      </button>

      <PageHeader
        title={seller?.name ?? '…'}
        subtitle={seller?.phone_number}
        actions={
          seller ? (
            <div className="flex items-center gap-3">
              {seller.status === 'active' && (
                <button type="button" className="btn-ghost" onClick={() => setDeactivateOpen(true)}>
                  {t('team.deactivate')}
                </button>
              )}
              {seller.status !== 'active' && (
                <button
                  type="button"
                  className="btn-ghost text-[#15803d] disabled:opacity-50"
                  disabled={activateM.isPending}
                  onClick={() => activateM.mutate()}
                >
                  {t('team.activate')}
                </button>
              )}
              {isAdmin && (
                <ItemActions onEdit={() => setEditOpen(true)} />
              )}
            </div>
          ) : undefined
        }
      />
      {activateM.isError ? <ErrorNote error={activateM.error} /> : null}

      <div className="mb-6">
        <StatsStrip stats={statsQ.data} />
      </div>

      <h2 className="mb-3 font-display text-lg font-semibold">{t('orders.title')}</h2>
      {ordersQ.isLoading ? (
        <Spinner />
      ) : (
        <OrderList orders={ordersQ.data ?? []} emptyTitle={t('orders.noMatch')} />
      )}

      <UserFormModal
        open={editOpen}
        editing={seller ?? null}
        onClose={() => setEditOpen(false)}
        role="seller"
      />
      <ConfirmDialog
        open={deactivateOpen}
        title={t('team.dismissAsk', { name: seller?.name ?? '' })}
        pending={deactivateM.isPending}
        error={deactivateM.isError ? deactivateM.error : undefined}
        onClose={() => setDeactivateOpen(false)}
        onConfirm={() => deactivateM.mutate()}
      />
    </div>
  );
}
