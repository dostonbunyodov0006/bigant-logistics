import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { VEHICLE_DOC_TYPES, vehicleDocTypeSchema, type VehicleDocumentPublic } from '@bigant/shared';
import { api } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';
import { Modal } from '../Modal';
import { ErrorNote, Field } from '../ui';

const formSchema = z.object({
  type: vehicleDocTypeSchema,
  number: z.string().optional(),
  issued_at: z.string().optional(),
  expires_at: z.string().min(1),
  holder_name: z.string().optional(),
  notes: z.string().optional(),
});
type FormValues = z.infer<typeof formSchema>;

const dateOnly = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');

export function VehicleDocumentFormModal({
  open,
  onClose,
  vehicleId,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  vehicleId: string;
  editing?: VehicleDocumentPublic | null;
}) {
  const { t } = useTranslation();
  const isEdit = !!editing;
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { type: 'other', number: '', issued_at: '', expires_at: '', holder_name: '', notes: '' },
  });

  useEffect(() => {
    if (open) {
      reset({
        type: editing?.type ?? 'other',
        number: editing?.number ?? '',
        issued_at: dateOnly(editing?.issued_at),
        expires_at: dateOnly(editing?.expires_at),
        holder_name: editing?.holder_name ?? '',
        notes: editing?.notes ?? '',
      });
    }
  }, [open, editing, reset]);
  const docType = watch('type');

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      if (isEdit && editing) {
        return api.patch(`/vehicles/${vehicleId}/documents/${editing.id}`, {
          type: values.type,
          number: values.number || null,
          issued_at: values.issued_at || null,
          expires_at: values.expires_at,
          holder_name: values.holder_name?.trim() || null,
          notes: values.notes || null,
        });
      }
      return api.post(`/vehicles/${vehicleId}/documents`, {
        type: values.type,
        expires_at: values.expires_at,
        ...(values.number ? { number: values.number } : {}),
        ...(values.issued_at ? { issued_at: values.issued_at } : {}),
        ...(values.holder_name?.trim() ? { holder_name: values.holder_name.trim() } : {}),
        ...(values.notes ? { notes: values.notes } : {}),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vehicle', vehicleId, 'documents'] });
      void queryClient.invalidateQueries({ queryKey: ['fleet-docs'] });
      void queryClient.invalidateQueries({ queryKey: ['seller-board'] });
      reset();
      onClose();
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? t('vehicleDocForm.editTitle') : t('vehicleDocForm.createTitle')}
    >
      <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4" noValidate>
        {mutation.isError && <ErrorNote error={mutation.error} />}
        <Field label={t('vehicleDocForm.type')}>
          <select className="input" {...register('type')}>
            {VEHICLE_DOC_TYPES.map((d) => (
              <option key={d} value={d}>
                {t(`vehicleDocType.${d}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('vehicleDocForm.number')}>
          <input className="input" {...register('number')} />
        </Field>
        <Field label={t('vehicleDocForm.issued')}>
          <input type="date" className="input" {...register('issued_at')} />
        </Field>
        <Field label={t('vehicleDocForm.expires')} error={errors.expires_at?.message}>
          <input type="date" className="input" {...register('expires_at')} />
        </Field>
        {docType === 'power_of_attorney' && (
          <Field label={t('documents.holder')}>
            <input className="input" placeholder={t('documents.holderPlaceholder')} {...register('holder_name')} />
          </Field>
        )}
        <Field label={t('vehicleDocForm.notes')}>
          <input className="input" {...register('notes')} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="submit" className="btn-primary" disabled={mutation.isPending}>
            {mutation.isPending
              ? t('common.saving')
              : isEdit
                ? t('vehicleDocForm.save')
                : t('vehicleDocForm.create')}
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
