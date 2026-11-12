import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { INCIDENT_TYPES, incidentTypeSchema } from '@bigant/shared';
import { api } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';
import { Modal } from '../Modal';
import { ErrorNote, Field } from '../ui';

const formSchema = z.object({
  type: incidentTypeSchema,
  occurred_at: z.string().optional(),
  description: z.string().optional(),
});
type FormValues = z.infer<typeof formSchema>;

export function VehicleIncidentFormModal({
  open,
  onClose,
  vehicleId,
}: {
  open: boolean;
  onClose: () => void;
  vehicleId: string;
}) {
  const { t } = useTranslation();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { type: 'accident', occurred_at: '', description: '' },
  });

  useEffect(() => {
    if (open) reset({ type: 'accident', occurred_at: '', description: '' });
  }, [open, reset]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      api.post(`/vehicles/${vehicleId}/incidents`, {
        type: values.type,
        ...(values.occurred_at ? { occurred_at: values.occurred_at } : {}),
        ...(values.description ? { description: values.description } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vehicle', vehicleId, 'incidents'] });
      reset();
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title={t('incidentForm.title')}>
      <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4" noValidate>
        {mutation.isError && <ErrorNote error={mutation.error} />}
        <Field label={t('incidentForm.type')}>
          <select className="input" {...register('type')}>
            {INCIDENT_TYPES.map((it) => (
              <option key={it} value={it}>
                {t(`incidentType.${it}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('incidentForm.occurred')} error={errors.occurred_at?.message}>
          <input type="date" className="input" {...register('occurred_at')} />
        </Field>
        <Field label={t('incidentForm.description')}>
          <input className="input" {...register('description')} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="submit" className="btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? t('common.saving') : t('incidentForm.create')}
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
