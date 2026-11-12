import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  type BoardResponse,
  type ClientPublic,
  type CreateVozvratOrderInput,
  type DriverPublic,
  type OrderPublic,
  type PickupPlacePublic,
} from '@bigant/shared';
import { api, ApiError } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { useAuth } from '../auth/AuthContext';
import { Card, Field, PageHeader } from '../components/ui';
import { toward } from '../lib/uz';
import { TZ, fromTkInput, tkInput } from '../lib/tashkent';
import { useSearchOptions } from '../lib/useSearchOptions';
import { SearchInput } from '../components/SearchInput';

/** Now, as <input type="datetime-local"> wants it. */
function localNow(): string {
  const d = new Date();
  return tkInput(d);
}

/**
 * A vozvrat order: a client gives goods back days after a delivery. The office
 * (or the seller) says which client, which delivery it comes from, where the
 * goods go back to, and who fetches them; the driver's app runs it as
 * client → that place, writing up the products at the client.
 */
export function CreateVozvratOrderPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [clientId, setClientId] = useState('');
  // Which of the client's places the goods are collected from.
  const [addressId, setAddressId] = useState('');
  const [originalOrderId, setOriginalOrderId] = useState('');
  const [placeId, setPlaceId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [when, setWhen] = useState(localNow());
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Searched on the server, so every client can be found, not the first page.
  const [clientSearch, setClientSearch] = useState('');
  const clients = useSearchOptions<ClientPublic>('/clients', clientSearch, clientId);
  const addresses = useMemo(
    () => clients.data?.find((c) => c.id === clientId)?.addresses ?? [],
    [clients.data, clientId],
  );
  useEffect(() => {
    const fallback = addresses.find((a) => a.is_default)?.id ?? addresses[0]?.id ?? '';
    if (!addresses.some((a) => a.id === addressId)) setAddressId(fallback);
  }, [addresses, addressId]);

  const places = useQuery({
    queryKey: ['pickup-places'],
    queryFn: () => api.get<PickupPlacePublic[]>('/pickup-places'),
  });
  const isSeller = user?.role === 'seller';
  // A seller picks the lorry the way he books one for a delivery: off the
  // board, from what is free right now. Without this the vozvrat was created
  // with nobody to fetch it and he had no way to say who should.
  const freeVehicles = useQuery({
    queryKey: ['seller-board', 'free'],
    queryFn: () => api.get<BoardResponse>('/seller/board?view=free'),
    enabled: isSeller,
  });
  const drivers = useQuery({
    queryKey: ['drivers', 'all'],
    queryFn: () => api.get<DriverPublic[]>('/drivers'),
    enabled: user?.role !== 'seller',
  });
  const deliveries = useQuery({
    queryKey: ['orders', 'delivered-for', clientId],
    queryFn: () => api.get<OrderPublic[]>(`/orders?client_id=${clientId}&statuses=delivered,returned&take=50`),
    enabled: !!clientId,
  });

  const create = useMutation({
    mutationFn: async () => {
      const body: CreateVozvratOrderInput = {
        client_id: clientId,
        client_address_id: addressId || null,
        original_order_id: originalOrderId || null,
        pickup_place_id: placeId,
        // The seller is not asked when: a return he books is today's work, and
        // the field was one more thing to tab past. The office still plans.
        pickup_datetime: isSeller || !when ? null : fromTkInput(when),
        comment: comment.trim() || null,
      };
      const order = await api.post<OrderPublic>('/orders/vozvrat', body);
      if (driverId) {
        // The order exists from here on; a driver who cannot take it must not
        // send the operator back to a filled-in form to create a second one.
        try {
          await api.post('/assignments', { order_id: order.id, driver_id: driverId });
        } catch (err) {
          return { order, assignError: err instanceof Error ? err.message : 'generic' };
        }
      }
      return { order, assignError: null };
    },
    onSuccess: ({ order, assignError }) => {
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      navigate(user?.role === 'seller' ? '/seller' : `/orders/${order.id}`, {
        replace: true,
        ...(assignError ? { state: { assignError } } : {}),
      });
    },
    onError: (err) => {
      const code = err instanceof ApiError ? err.message : '';
      setError(
        code === 'vozvrat_original_order_not_delivered'
          ? t('createVozvrat.errNotDelivered')
          : code === 'vozvrat_original_order_invalid'
            ? t('createVozvrat.errOriginalInvalid')
            : t('createVozvrat.errGeneric'),
      );
    },
  });

  const canSubmit = !!clientId && !!placeId && !create.isPending;
  const client = clients.data?.find((c) => c.id === clientId);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t('createVozvrat.title')} subtitle={t('createVozvrat.subtitle')} />
      <Card className="p-5">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            if (canSubmit) create.mutate();
          }}
        >
          <Field label={t('createVozvrat.client')}>
            <div className="mb-2">
              <SearchInput value={clientSearch} onChange={setClientSearch} placeholder={t('clients.search')} />
            </div>
            <select
              className="input"
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                setOriginalOrderId('');
              }}
              required
            >
              <option value="">{t('createVozvrat.selectClient')}</option>
              {(clients.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.phone_number}
                </option>
              ))}
            </select>
            {client?.address ? <div className="mt-1 text-xs text-slate">{client.address}</div> : null}
          </Field>

          {addresses.length > 1 && (
            <Field label={t('createOrder.deliveryAddress')}>
              <select className="input" value={addressId} onChange={(e) => setAddressId(e.target.value)}>
                {addresses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                    {a.address ? ` — ${a.address}` : ''}
                    {a.is_default ? ` · ${t('clientAddresses.default')}` : ''}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label={t('createVozvrat.originalOrder')}>
            <select className="input" value={originalOrderId} onChange={(e) => setOriginalOrderId(e.target.value)} disabled={!clientId}>
              <option value="">{t('createVozvrat.noOriginal')}</option>
              {(deliveries.data ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.client_name} · {new Date(o.delivery_datetime).toLocaleDateString('ru-RU', { timeZone: TZ })}
                  {o.created_by_seller_name ? ` · ${o.created_by_seller_name}` : ''}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t('createVozvrat.place')}>
            <select className="input" value={placeId} onChange={(e) => setPlaceId(e.target.value)} required>
              <option value="" hidden />
              {(places.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {toward(p.name)}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            {!isSeller && (
              <Field label={t('createVozvrat.when')}>
                <input type="datetime-local" className="input" value={when} onChange={(e) => setWhen(e.target.value)} />
              </Field>
            )}
            {isSeller ? (
              <Field label={t('createVozvrat.vehicle')}>
                <select className="input" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                  <option value="">{t('createVozvrat.pickVehicle')}</option>
                  {[...(freeVehicles.data?.katta ?? []), ...(freeVehicles.data?.yengil ?? [])]
                    .filter((v) => v.driver_id)
                    .map((v) => (
                      <option key={v.id} value={v.driver_id!}>
                        {v.plate_number} · {v.model}
                        {v.driver_name ? ` · ${v.driver_name}` : ''} ·{' '}
                        {t('createVozvrat.vehicleFree')}
                      </option>
                    ))}
                </select>
              </Field>
            ) : (
              <Field label={t('createVozvrat.driver')}>
                <select className="input" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                  <option value="">{t('createVozvrat.noDriverYet')}</option>
                  {(drivers.data ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.vehicle_plate ? ` · ${d.vehicle_plate}` : ''}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>

          <Field label={t('createVozvrat.comment')}>
            <textarea className="input" rows={2} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('createVozvrat.commentPlaceholder')} />
          </Field>

          {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="submit" className="btn-primary" disabled={!canSubmit}>
              {create.isPending ? t('createVozvrat.creating') : t('createVozvrat.submit')}
            </button>
            <button type="button" className="btn-ghost" onClick={() => navigate(-1)}>
              {t('createVozvrat.cancel')}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
