import { useEffect, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type {
  ClientPublic,
  ConflictWarning,
  DriverPublic,
  OrderPublic,
  PickupPlacePublic,
} from '@bigant/shared';
import { api } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { Card, ErrorNote, Field, PageHeader } from '../components/ui';
import { ClientFormModal } from '../components/forms/ClientFormModal';
import { PickupPlaceFormModal } from '../components/forms/PickupPlaceFormModal';
import { fromTkInput } from '../lib/tashkent';
import { useSearchOptions } from '../lib/useSearchOptions';
import { SearchInput } from '../components/SearchInput';

interface FormValues {
  client_id: string;
  client_address_id: string;
  delivery_datetime: string;
  priority: 'normal' | 'urgent';
  comment: string;
  items: { product_name: string; quantity: number; pickup_place_id: string }[];
}

export function CreateOrderPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [clientModal, setClientModal] = useState(false);
  const [placeModal, setPlaceModal] = useState(false);
  const [placeTargetRow, setPlaceTargetRow] = useState<number | null>(null);
  const [driverId, setDriverId] = useState('');

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      client_id: '',
      client_address_id: '',
      delivery_datetime: '',
      priority: 'normal',
      comment: '',
      items: [{ product_name: '', quantity: 1, pickup_place_id: '' }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'items' });

  // Searched on the server, so every client can be found, not the first page.
  const [clientSearch, setClientSearch] = useState('');
  const clients = useSearchOptions<ClientPublic>('/clients', clientSearch, watch('client_id'));
  const places = useQuery({
    queryKey: ['pickup-places'],
    queryFn: () => api.get<PickupPlacePublic[]>('/pickup-places'),
  });
  const drivers = useQuery({
    queryKey: ['drivers'],
    queryFn: () => api.get<DriverPublic[]>('/drivers'),
  });

  const selectedClient = clients.data?.find((c) => c.id === watch('client_id'));
  // Where it goes: a regular customer has a shop, a second shop and a yard.
  // With one address there is nothing to ask, so the field only appears when
  // there is a choice; the default is already selected either way.
  const addresses = selectedClient?.addresses ?? [];
  const addressId = watch('client_address_id');
  const chosenAddress = addresses.find((a) => a.id === addressId) ?? addresses.find((a) => a.is_default);

  // Changing the client makes its own default the selected place.
  useEffect(() => {
    const fallback = addresses.find((a) => a.is_default)?.id ?? addresses[0]?.id ?? '';
    if (!addresses.some((a) => a.id === addressId)) {
      setValue('client_address_id', fallback);
    }
  }, [addresses, addressId, setValue]);

  const deliveryLocal = watch('delivery_datetime');
  const deliveryIso = deliveryLocal ? fromTkInput(deliveryLocal) : '';
  const conflicts = useQuery({
    queryKey: ['conflicts', driverId, deliveryIso],
    queryFn: () =>
      api.get<ConflictWarning[]>(
        `/assignments/conflicts?driver_id=${driverId}&delivery_datetime=${encodeURIComponent(deliveryIso)}`,
      ),
    enabled: Boolean(driverId) && Boolean(deliveryIso),
  });

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const order = await api.post<OrderPublic>('/orders', {
        client_id: values.client_id,
        client_address_id: values.client_address_id || undefined,
        delivery_datetime: fromTkInput(values.delivery_datetime),
        comment: values.comment || undefined,
        priority: values.priority,
        items: values.items.map((i) => ({
          product_name: i.product_name,
          quantity: Number(i.quantity),
          pickup_place_id: i.pickup_place_id,
        })),
      });
      if (driverId) {
        // The order already exists. If the driver cannot take it — busy,
        // offline, a clash — say so on the order's own page instead of
        // failing the whole form: the operator used to see an error, press
        // Create again, and the client got two orders.
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
      navigate(`/orders/${order.id}`, assignError ? { state: { assignError } } : undefined);
    },
  });

  const onSubmit = handleSubmit((values) => mutation.mutate(values));

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t('createOrder.title')} subtitle={t('createOrder.subtitle')} />
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {mutation.isError && <ErrorNote error={mutation.error} />}

        <Card className="space-y-4 p-5">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Field label={t('createOrder.client')} error={errors.client_id?.message}>
                <div className="mb-2">
                  <SearchInput value={clientSearch} onChange={setClientSearch} placeholder={t('clients.search')} />
                </div>
                <select className="input" {...register('client_id', { required: t('common.requiredField') })}>
                  <option value="">{t('createOrder.selectClient')}</option>
                  {clients.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {c.phone_number}
                      {/* Two sellers may each have the same customer; the owner tells them apart. */}
                      {c.seller_name ? ` · ${c.seller_name}` : ''}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <button type="button" className="btn-ghost" onClick={() => setClientModal(true)}>
              {t('createOrder.newShort')}
            </button>
          </div>
          {addresses.length > 1 && (
            <Field label={t('createOrder.deliveryAddress')}>
              <select className="input" {...register('client_address_id')}>
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
          {addresses.length === 1 && addresses[0] && (
            <p className="text-sm text-slate">
              {t('createOrder.deliveryAddressOne', {
                label: addresses[0].label,
                address: addresses[0].address ?? '',
              })}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('createOrder.deliveryDateTime')} error={errors.delivery_datetime?.message}>
              <input
                type="datetime-local"
                className="input"
                {...register('delivery_datetime', { required: t('common.requiredField') })}
              />
            </Field>
            <Field label={t('createOrder.priority')}>
              <select className="input" {...register('priority')}>
                <option value="normal">{t('priority.normal')}</option>
                <option value="urgent">{t('priority.urgent')}</option>
              </select>
            </Field>
            <Field label={t('createOrder.deliveryRegion')}>
              <div className="input flex items-center bg-paper text-slate">
                {chosenAddress?.region_name
                  ? [chosenAddress.region_name, chosenAddress.district_name].filter(Boolean).join(' · ')
                  : selectedClient?.region_name
                    ? [selectedClient.region_name, selectedClient.district_name].filter(Boolean).join(' · ')
                    : t('createOrder.deliveryRegionHint')}
              </div>
            </Field>
          </div>
          <Field label={t('createOrder.commentOptional')}>
            <input
              className="input"
              placeholder={t('createOrder.commentPlaceholder')}
              {...register('comment')}
            />
          </Field>
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-slate-light">
              {t('createOrder.products')}
            </h2>
            <button
              type="button"
              className="text-sm font-medium text-brand hover:text-brand-dark"
              onClick={() => append({ product_name: '', quantity: 1, pickup_place_id: '' })}
            >
              {t('createOrder.addProduct')}
            </button>
          </div>
          <div className="space-y-3">
            {fields.map((f, idx) => (
              <div key={f.id} className="grid grid-cols-12 items-end gap-2">
                <div className="col-span-5">
                  <Field
                    label={idx === 0 ? t('createOrder.product') : ''}
                    error={errors.items?.[idx]?.product_name?.message}
                  >
                    <input
                      className="input"
                      placeholder={t('createOrder.productPlaceholder')}
                      {...register(`items.${idx}.product_name` as const, {
                        required: t('common.requiredField'),
                      })}
                    />
                  </Field>
                </div>
                <div className="col-span-2">
                  <Field
                    label={idx === 0 ? t('createOrder.qty') : ''}
                    error={errors.items?.[idx]?.quantity?.message}
                  >
                    <input
                      type="number"
                      min={1}
                      className="input"
                      {...register(`items.${idx}.quantity` as const, {
                        valueAsNumber: true,
                        validate: (value) => Number(value) > 0 || t('common.requiredField'),
                      })}
                    />
                  </Field>
                </div>
                <div className="col-span-4">
                  <Field
                    label={idx === 0 ? t('createOrder.pickupPlace') : ''}
                    error={errors.items?.[idx]?.pickup_place_id?.message}
                  >
                    <select
                      className="input"
                      {...register(`items.${idx}.pickup_place_id` as const, { required: t('common.requiredField') })}
                    >
                      <option value="">{t('createOrder.select')}</option>
                      {places.data?.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div className="col-span-1 flex gap-1">
                  <button
                    type="button"
                    title={t('createOrder.addCustomPlace')}
                    className="btn-ghost px-2"
                    onClick={() => {
                      setPlaceTargetRow(idx);
                      setPlaceModal(true);
                    }}
                  >
                    +
                  </button>
                  {fields.length > 1 && (
                    <button
                      type="button"
                      title={t('createOrder.remove')}
                      className="btn-ghost px-2"
                      onClick={() => remove(idx)}
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="space-y-3 p-5">
          <Field label={t('createOrder.assignDriverOptional')}>
            <select
              className="input"
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
            >
              <option value="">{t('createOrder.leaveUnassigned')}</option>
              {drivers.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} — {t(`driverStatus.${d.current_status}`)}
                </option>
              ))}
            </select>
          </Field>
          {conflicts.data && conflicts.data.length > 0 && (
            <div className="rounded-lg bg-brand-tint px-3 py-2 text-sm text-brand-dark">
              ⚠ {t('createOrder.conflictPrebooking', { message: conflicts.data[0].message })}
            </div>
          )}
        </Card>

        <div className="flex justify-end gap-2">
          <button type="submit" className="btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? t('createOrder.creating') : t('createOrder.createOrder')}
          </button>
          <button type="button" className="btn-ghost" onClick={() => navigate('/orders')}>
            {t('common.cancel')}
          </button>
        </div>
      </form>

      <ClientFormModal
        open={clientModal}
        onClose={() => setClientModal(false)}
        onCreated={(c) => setValue('client_id', c.id, { shouldValidate: true })}
      />
      <PickupPlaceFormModal
        open={placeModal}
        onClose={() => setPlaceModal(false)}
        onCreated={(p) => {
          if (placeTargetRow !== null) {
            setValue(`items.${placeTargetRow}.pickup_place_id`, p.id, { shouldValidate: true });
          }
        }}
      />
    </div>
  );
}
