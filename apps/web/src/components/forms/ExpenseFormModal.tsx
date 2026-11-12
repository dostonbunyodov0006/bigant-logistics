import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type {
  DriverPublic,
  ExpensePublic,
  ExpenseTypePublic,
  VehiclePublic,
} from '@bigant/shared';
import { MAX_PAGE_SIZE } from '@bigant/shared';
import { api } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';
import { Modal } from '../Modal';
import { ErrorNote, Field } from '../ui';
import { tkYmd } from '../../lib/tashkent';

interface FormValues {
  type_id: string;
  amount: number;
  spent_at: string;
  vehicle_id: string;
  driver_id: string;
  note: string;
}

const today = () => {
  const d = new Date();
  return tkYmd(d);
};

export function ExpenseFormModal({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing?: ExpensePublic | null;
}) {
  const { t } = useTranslation();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>();

  const typesQ = useQuery({
    queryKey: ['expenses', 'types'],
    queryFn: () => api.get<ExpenseTypePublic[]>('/expenses/types'),
    enabled: open,
  });
  const vehiclesQ = useQuery({
    queryKey: ['vehicles'],
      // Reference dropdown: bounded explicitly. A fleet/roster past this size
      // needs a searchable picker rather than a <select>.
    queryFn: () => api.get<VehiclePublic[]>(`/vehicles?take=${MAX_PAGE_SIZE}`),
    enabled: open,
  });
  const driversQ = useQuery({
    queryKey: ['drivers'],
    queryFn: () => api.get<DriverPublic[]>('/drivers'),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    reset(
      editing
        ? {
            type_id: editing.type_id,
            amount: editing.amount,
            spent_at: editing.spent_at,
            vehicle_id: editing.vehicle_id ?? '',
            driver_id: editing.driver_id ?? '',
            note: editing.note ?? '',
          }
        : { type_id: '', amount: 0, spent_at: today(), vehicle_id: '', driver_id: '', note: '' },
    );
  }, [open, editing, reset]);

  // Only active types are offered; keep an inactive type visible when editing one.
  const types = (typesQ.data ?? []).filter((tp) => tp.active || tp.id === editing?.type_id);

  const mutation = useMutation({
    mutationFn: (v: FormValues) => {
      const payload = {
        type_id: v.type_id,
        amount: Number(v.amount),
        spent_at: v.spent_at,
        note: v.note.trim() || null,
        vehicle_id: v.vehicle_id || null,
        driver_id: v.driver_id || null,
      };
      return editing
        ? api.patch<ExpensePublic>(`/expenses/${editing.id}`, payload)
        : api.post<ExpensePublic>('/expenses', payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title={editing ? t('expenses.editTitle') : t('expenses.newTitle')}>
      <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4" noValidate>
        {mutation.isError && <ErrorNote error={mutation.error} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('expenses.type')} error={errors.type_id?.message}>
            <select
              className="input"
              {...register('type_id', { required: t('common.requiredField') })}
            >
              <option value="">{t('expenses.selectType')}</option>
              {types.map((tp) => (
                <option key={tp.id} value={tp.id}>{tp.name}</option>
              ))}
            </select>
          </Field>
          <Field label={t('expenses.amount')} error={errors.amount?.message}>
            <input
              type="number"
              min={1}
              className="input"
              {...register('amount', { valueAsNumber: true, min: { value: 1, message: t('common.requiredField') } })}
            />
          </Field>
        </div>
        <Field label={t('expenses.spentAt')} error={errors.spent_at?.message}>
          <input type="date" className="input" {...register('spent_at', { required: t('common.requiredField') })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('expenses.vehicle')}>
            <select className="input" {...register('vehicle_id')}>
              <option value="">{t('expenses.noVehicle')}</option>
              {vehiclesQ.data?.map((v) => (
                <option key={v.id} value={v.id}>{v.plate_number} · {v.model}</option>
              ))}
            </select>
          </Field>
          <Field label={t('expenses.driver')}>
            <select className="input" {...register('driver_id')}>
              <option value="">{t('expenses.noDriver')}</option>
              {driversQ.data?.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label={t('expenses.note')}>
          <textarea rows={2} className="input" {...register('note')} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="submit" className="btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? t('common.saving') : editing ? t('common.saveChanges') : t('expenses.createExpense')}
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
