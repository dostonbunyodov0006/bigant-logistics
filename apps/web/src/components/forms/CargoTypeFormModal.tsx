import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { CargoTypePublic } from '@bigant/shared';
import { api } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';
import { Modal } from '../Modal';
import { ErrorNote, Field } from '../ui';

interface FormValues {
  name: string;
  active: boolean;
}

export function CargoTypeFormModal({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing?: CargoTypePublic | null;
}) {
  const { t } = useTranslation();
  const isEdit = !!editing;
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: { name: '', active: true } });

  useEffect(() => {
    if (open) reset({ name: editing?.name ?? '', active: editing?.active ?? true });
  }, [open, editing, reset]);

  const mutation = useMutation({
    mutationFn: (v: FormValues) =>
      isEdit && editing
        ? api.patch<CargoTypePublic>(`/cargo-types/${editing.id}`, { name: v.name, active: v.active })
        : api.post<CargoTypePublic>('/cargo-types', { name: v.name }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['cargo-types'] });
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? t('cargoTypes.editTitle') : t('cargoTypes.newTitle')}>
      <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4" noValidate>
        {mutation.isError && <ErrorNote error={mutation.error} />}
        <Field label={t('cargoTypes.name')} error={errors.name?.message}>
          <input
            className="input"
            placeholder={t('cargoTypes.namePlaceholder')}
            {...register('name', { required: t('common.requiredField') })}
          />
        </Field>
        {isEdit && (
          <label className="flex items-center gap-2 text-sm text-graphite">
            <input type="checkbox" {...register('active')} />
            {t('cargoTypes.active')}
          </label>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="submit" className="btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? t('common.saving') : isEdit ? t('common.saveChanges') : t('cargoTypes.create')}
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
