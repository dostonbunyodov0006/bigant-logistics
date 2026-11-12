import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { DRIVER_DOC_TYPES, driverDocTypeSchema, type DriverDocumentPublic } from '@bigant/shared';
import { api } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';
import { Modal } from '../Modal';
import { ErrorNote, Field } from '../ui';

const formSchema = z.object({
  type: driverDocTypeSchema,
  number: z.string().optional(),
  issued_at: z.string().optional(),
  expires_at: z.string().min(1),
  notes: z.string().optional(),
});
type FormValues = z.infer<typeof formSchema>;

const dateOnly = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');

export function DriverDocumentFormModal({
  open,
  onClose,
  driverId,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  driverId: string;
  editing?: DriverDocumentPublic | null;
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
    defaultValues: { type: 'license', number: '', issued_at: '', expires_at: '', notes: '' },
  });

  useEffect(() => {
    if (open) {
      reset({
        type: editing?.type ?? 'license',
        number: editing?.number ?? '',
        issued_at: dateOnly(editing?.issued_at),
        expires_at: dateOnly(editing?.expires_at),
        notes: editing?.notes ?? '',
      });
    }
  }, [open, editing, reset]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      if (isEdit && editing) {
        return api.patch(`/drivers/${driverId}/documents/${editing.id}`, {
          type: values.type,
          number: values.number || null,
          issued_at: values.issued_at || null,
          expires_at: values.expires_at,
          notes: values.notes || null,
        });
      }
      return api.post(`/drivers/${driverId}/documents`, {
        type: values.type,
        expires_at: values.expires_at,
        ...(values.number ? { number: values.number } : {}),
        ...(values.issued_at ? { issued_at: values.issued_at } : {}),
        ...(values.notes ? { notes: values.notes } : {}),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['driver', driverId, 'documents'] });
      void queryClient.invalidateQueries({ queryKey: ['driver', driverId] });
      reset();
      onClose();
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? t('driverDocForm.editTitle') : t('driverDocForm.createTitle')}
    >
      <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4" noValidate>
        {mutation.isError && <ErrorNote error={mutation.error} />}
        <Field label={t('driverDocForm.type')}>
          <select className="input" {...register('type')}>
            {DRIVER_DOC_TYPES.map((d) => (
              <option key={d} value={d}>
                {t(`driverDocType.${d}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('driverDocForm.number')}>
          <input className="input" {...register('number')} />
        </Field>
        <Field label={t('driverDocForm.issued')}>
          <input type="date" className="input" {...register('issued_at')} />
        </Field>
        <Field label={t('driverDocForm.expires')} error={errors.expires_at?.message}>
          <input type="date" className="input" {...register('expires_at')} />
        </Field>
        <Field label={t('driverDocForm.notes')}>
          <input className="input" {...register('notes')} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="submit" className="btn-primary" disabled={mutation.isPending}>
            {mutation.isPending
              ? t('common.saving')
              : isEdit
                ? t('driverDocForm.save')
                : t('driverDocForm.create')}
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
