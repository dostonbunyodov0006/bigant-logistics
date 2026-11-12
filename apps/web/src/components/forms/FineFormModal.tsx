import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { DriverPublic, FinePublic, OrderPublic } from '@bigant/shared';
import { api } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';
import { Modal } from '../Modal';
import { ErrorNote, Field } from '../ui';
import { TZ } from '../../lib/tashkent';

interface FormValues {
  driver_id: string;
  amount: number;
  reason: string;
  order_id: string;
}

const EMPTY: FormValues = { driver_id: '', amount: 50000, reason: '', order_id: '' };

export function FineFormModal({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing?: FinePublic | null;
}) {
  const { t } = useTranslation();
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: EMPTY });

  const drivers = useQuery({
    queryKey: ['drivers'],
    queryFn: () => api.get<DriverPublic[]>('/drivers'),
    enabled: open,
  });

  // The optional order link is scoped to the chosen driver's orders.
  const driverId = watch('driver_id');
  const orders = useQuery({
    queryKey: ['orders', 'by-driver', driverId],
    queryFn: () => api.get<OrderPublic[]>(`/orders?driver_id=${driverId}`),
    enabled: open && !!driverId,
  });

  useEffect(() => {
    if (!open) return;
    reset(
      editing
        ? {
            driver_id: editing.driver_id,
            amount: editing.amount,
            reason: editing.reason,
            order_id: editing.order_id ?? '',
          }
        : EMPTY,
    );
  }, [open, editing, reset]);

  const mutation = useMutation({
    mutationFn: (v: FormValues) => {
      const payload = {
        amount: Number(v.amount),
        reason: v.reason,
        order_id: v.order_id || null,
      };
      return editing
        ? api.patch<FinePublic>(`/fines/${editing.id}`, payload)
        : api.post<FinePublic>('/fines', { ...payload, driver_id: v.driver_id });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['fines'] });
      onClose();
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? t('fineForm.editTitle') : t('fineForm.newTitle')}
    >
      <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4" noValidate>
        {mutation.isError && <ErrorNote error={mutation.error} />}
        <Field label={t('fineForm.driver')} error={errors.driver_id?.message}>
          {/* Driver can't be reassigned on an existing fine — void and re-create instead. */}
          <select className="input" disabled={!!editing} {...register('driver_id', { required: t('common.requiredField') })}>
            <option value="">{t('fineForm.selectDriver')}</option>
            {drivers.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('fineForm.amount')} error={errors.amount?.message}>
          <input
            type="number"
            min={1}
            className="input"
            {...register('amount', { valueAsNumber: true, min: { value: 1, message: t('common.requiredField') } })}
          />
        </Field>
        <Field label={t('fineForm.reason')} error={errors.reason?.message}>
          <textarea rows={3} className="input" {...register('reason', { required: t('common.requiredField') })} />
        </Field>
        <Field label={t('fineForm.order')}>
          <select className="input" disabled={!driverId} {...register('order_id')}>
            <option value="">{t('fineForm.noOrder')}</option>
            {orders.data?.map((o) => (
              <option key={o.id} value={o.id}>
                {o.client_name} · {new Date(o.delivery_datetime).toLocaleDateString('ru-RU', { timeZone: TZ })}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="submit" className="btn-primary" disabled={mutation.isPending}>
            {mutation.isPending
              ? t('common.saving')
              : editing
                ? t('common.saveChanges')
                : t('fineForm.createFine')}
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
