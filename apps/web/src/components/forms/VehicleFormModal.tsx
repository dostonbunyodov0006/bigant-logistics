import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import {
  VEHICLE_CATEGORIES,
  VEHICLE_STATUSES,
  vehicleStatusSchema,
  vehicleCategorySchema,
  type VehiclePublic,
} from '@bigant/shared';
import { api } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';
import { Modal } from '../Modal';
import { ErrorNote, Field } from '../ui';

const formSchema = z.object({
  plate_number: z.string().min(1),
  model: z.string().min(1),
  tech_passport: z.string().optional(),
  owner: z.string().optional(),
  model_year: z.string().optional(),
  capacity_kg: z.string().optional(),
  length_cm: z.string().optional(),
  width_cm: z.string().optional(),
  height_cm: z.string().optional(),
  category: vehicleCategorySchema,
  status: vehicleStatusSchema.optional(),
  notes: z.string().optional(),
});
type FormValues = z.infer<typeof formSchema>;

export function VehicleFormModal({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing?: VehiclePublic | null;
}) {
  const { t } = useTranslation();
  const isEdit = !!editing;
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { plate_number: '', model: '', tech_passport: '', owner: '', model_year: '', capacity_kg: '', length_cm: '', width_cm: '', height_cm: '', category: undefined, notes: '' },
  });

  useEffect(() => {
    if (open) {
      reset({
        plate_number: editing?.plate_number ?? '',
        model: editing?.model ?? '',
        tech_passport: editing?.tech_passport ?? '',
        owner: editing?.owner ?? '',
        model_year: editing?.model_year != null ? String(editing.model_year) : '',
        capacity_kg: editing?.capacity_kg != null ? String(editing.capacity_kg) : '',
        length_cm: editing?.length_cm != null ? String(editing.length_cm) : '',
        width_cm: editing?.width_cm != null ? String(editing.width_cm) : '',
        height_cm: editing?.height_cm != null ? String(editing.height_cm) : '',
        category: editing?.category ?? undefined,
        status: editing?.status ?? 'active',
        notes: editing?.notes ?? '',
      });
    }
  }, [open, editing, reset]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const payload = {
        plate_number: values.plate_number,
        model: values.model,
        tech_passport: values.tech_passport?.trim() || null,
        owner: values.owner?.trim() || null,
        model_year: values.model_year ? Number(values.model_year) : null,
        capacity_kg: values.capacity_kg ? Number(values.capacity_kg) : null,
        length_cm: values.length_cm ? Number(values.length_cm) : null,
        width_cm: values.width_cm ? Number(values.width_cm) : null,
        height_cm: values.height_cm ? Number(values.height_cm) : null,
        category: values.category,
        notes: values.notes || null,
        ...(isEdit ? { status: values.status } : {}),
      };
      return isEdit && editing
        ? api.patch<VehiclePublic>(`/vehicles/${editing.id}`, payload)
        : api.post<VehiclePublic>('/vehicles', payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      // Edited from its own page now, so the single-item query has to be told
      // as well — otherwise the header keeps the old name.
      void queryClient.invalidateQueries({ queryKey: ['vehicle'] });
      reset();
      onClose();
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? t('vehicleForm.editTitle') : t('vehicleForm.createTitle')}
    >
      <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4" noValidate>
        {mutation.isError && <ErrorNote error={mutation.error} />}
        <Field label={t('vehicleForm.plate')} error={errors.plate_number?.message}>
          <input className="input" placeholder="01A123BC" {...register('plate_number')} />
        </Field>
        <Field label={t('vehicleForm.model')} error={errors.model?.message}>
          <input className="input" placeholder="Isuzu NQR" {...register('model')} />
        </Field>
        <Field label={t('vehicleForm.techPassport')}>
          <input className="input" placeholder="AAG 1234567" {...register('tech_passport')} />
        </Field>
        <Field label={t('vehicleForm.owner')}>
          <input className="input" {...register('owner')} />
        </Field>
        <Field label={t('vehicleForm.modelYear')}>
          <input type="number" min="1950" max="2100" className="input" placeholder="2025" {...register('model_year')} />
        </Field>
        <Field label={t('vehicleForm.capacity')}>
          <input type="number" min="0" className="input" placeholder="3000" {...register('capacity_kg')} />
        </Field>
        <Field label={t('vehicleForm.category')} error={errors.category ? t('common.requiredField') : undefined}>
          <select className="input" {...register('category')}>
            <option value="" disabled>{t('vehicleForm.categoryPlaceholder')}</option>
            {VEHICLE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`vehicleCategory.${c}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('vehicleForm.dimensions')}>
          <div className="grid grid-cols-3 gap-2">
            <input type="number" min="0" className="input" placeholder={t('vehicleForm.length')} {...register('length_cm')} />
            <input type="number" min="0" className="input" placeholder={t('vehicleForm.width')} {...register('width_cm')} />
            <input type="number" min="0" className="input" placeholder={t('vehicleForm.height')} {...register('height_cm')} />
          </div>
        </Field>
        {isEdit && (
          <Field label={t('vehicleForm.status')}>
            <select className="input" {...register('status')}>
              {VEHICLE_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {t(`vehicleStatus.${st}`)}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t('vehicleForm.notes')}>
          <input className="input" {...register('notes')} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="submit" className="btn-primary" disabled={mutation.isPending}>
            {mutation.isPending
              ? t('common.saving')
              : isEdit
                ? t('vehicleForm.save')
                : t('vehicleForm.create')}
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
