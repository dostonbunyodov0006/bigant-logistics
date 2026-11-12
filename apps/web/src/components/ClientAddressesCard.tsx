import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ClientAddressPublic } from '@bigant/shared';
import { api } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { Card, EmptyState, ErrorNote, Spinner } from './ui';
import { ClientAddressFormModal } from './forms/ClientAddressFormModal';
import { ItemActions } from './ItemActions';

/**
 * Where this client takes deliveries. Entered once here, picked by name on
 * every order after that — which is the point: nobody asks the customer for
 * directions twice, and the driver reads a name he knows.
 */
export function ClientAddressesCard({ clientId }: { clientId: string }) {
  const { t } = useTranslation();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ClientAddressPublic | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ['client-addresses', clientId],
    queryFn: () => api.get<ClientAddressPublic[]>(`/clients/${clientId}/addresses`),
  });

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.patch<ClientAddressPublic>(`/clients/addresses/${id}`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['client-addresses', clientId] });
      void queryClient.invalidateQueries({ queryKey: ['client', clientId] });
    },
  });

  const open = (address: ClientAddressPublic | null) => {
    setEditing(address);
    setFormOpen(true);
  };

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">{t('clientAddresses.title')}</h2>
          <p className="text-sm text-slate">{t('clientAddresses.subtitle')}</p>
        </div>
        <button type="button" className="btn-primary shrink-0" onClick={() => open(null)}>
          {t('clientAddresses.add')}
        </button>
      </div>

      {patch.isError && <ErrorNote error={patch.error} />}

      {isLoading ? (
        <Spinner />
      ) : data.length === 0 ? (
        <EmptyState title={t('clientAddresses.none')} hint={t('clientAddresses.noneHint')} />
      ) : (
        <ul className="divide-y divide-mist">
          {data.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink">{a.label}</span>
                  {a.is_default && (
                    <span className="rounded-full bg-[#e6f6ec] px-2 py-0.5 text-xs font-semibold text-[#15803d]">
                      {t('clientAddresses.default')}
                    </span>
                  )}
                  {!a.active && (
                    <span className="rounded-full bg-[#f0f1f3] px-2 py-0.5 text-xs font-medium text-[#8a93a0]">
                      {t('clientAddresses.closed')}
                    </span>
                  )}
                </div>
                <div className="truncate text-sm text-slate">
                  {[a.address, a.district_name, a.region_name].filter(Boolean).join(', ') ||
                    t('clientAddresses.noStreet')}
                </div>
                {a.lat == null && (
                  <div className="text-xs text-[#b45309]">{t('clientAddresses.noPin')}</div>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                {!a.is_default && a.active && (
                  <button
                    type="button"
                    className="rounded-lg border border-[#d8dce3] px-3 py-1 text-sm font-medium text-ink disabled:opacity-50"
                    disabled={patch.isPending}
                    onClick={() => patch.mutate({ id: a.id, body: { is_default: true } })}
                  >
                    {t('clientAddresses.makeDefaultShort')}
                  </button>
                )}
                <ItemActions size="sm" onEdit={() => open(a)} />
                {a.active ? (
                  <button
                    type="button"
                    className="rounded-lg border border-[#d8dce3] px-3 py-1 text-sm font-medium text-slate disabled:opacity-50"
                    disabled={patch.isPending || a.is_default}
                    title={a.is_default ? t('clientAddresses.cannotCloseDefault') : undefined}
                    onClick={() => patch.mutate({ id: a.id, body: { active: false } })}
                  >
                    {t('clientAddresses.close')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="rounded-lg border border-[#d8dce3] px-3 py-1 text-sm font-medium text-ink disabled:opacity-50"
                    disabled={patch.isPending}
                    onClick={() => patch.mutate({ id: a.id, body: { active: true } })}
                  >
                    {t('clientAddresses.reopen')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <ClientAddressFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        clientId={clientId}
        editing={editing}
      />
    </Card>
  );
}
