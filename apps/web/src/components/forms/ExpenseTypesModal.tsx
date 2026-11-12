import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ExpenseTypePublic } from '@bigant/shared';
import { api } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';
import { Modal } from '../Modal';
import { ErrorNote } from '../ui';
import { ItemActions } from '../ItemActions';

export function ExpenseTypesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [attempted, setAttempted] = useState(false);

  const typesQ = useQuery({
    queryKey: ['expenses', 'types'],
    queryFn: () => api.get<ExpenseTypePublic[]>('/expenses/types'),
    enabled: open,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['expenses', 'types'] });

  const createM = useMutation({
    mutationFn: () => api.post('/expenses/types', { name: name.trim() }),
    onSuccess: () => {
      setName('');
      setAttempted(false);
      void invalidate();
    },
  });
  const toggleM = useMutation({
    mutationFn: (tp: ExpenseTypePublic) => api.patch(`/expenses/types/${tp.id}`, { active: !tp.active }),
    onSuccess: () => void invalidate(),
  });
  const deleteM = useMutation({
    mutationFn: (id: string) => api.del(`/expenses/types/${id}`),
    onSuccess: () => void invalidate(),
  });

  return (
    <Modal open={open} onClose={onClose} title={t('expenses.manageTypes')}>
      <div className="space-y-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setAttempted(true);
            if (!name.trim()) {
              document.getElementById('expense-type-name')?.focus();
              return;
            }
            createM.mutate();
          }}
          className="flex items-start gap-2"
        >
          <div className="flex-1">
            <input
              id="expense-type-name"
              className={`input ${attempted && !name.trim() ? 'border-[#dc2626]' : ''}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('expenses.typeNamePlaceholder')}
              aria-invalid={attempted && !name.trim()}
            />
            {attempted && !name.trim() && (
              <p role="alert" className="mt-1 text-xs font-medium text-[#dc2626]">{t('common.requiredField')}</p>
            )}
          </div>
          <button type="submit" className="btn-primary" disabled={createM.isPending}>
            {t('expenses.addType')}
          </button>
        </form>
        {createM.isError && <ErrorNote error={createM.error} />}
        {deleteM.isError && <ErrorNote error={deleteM.error} />}
        {/* Switching a type off is refused while expenses still point at it;
            that answer used to be dropped on the floor. */}
        {toggleM.isError && <ErrorNote error={toggleM.error} />}

        <div className="divide-y divide-mist/60 rounded-lg border border-mist">
          {(typesQ.data ?? []).length === 0 ? (
            <p className="px-3 py-4 text-sm text-slate">{t('expenses.noTypes')}</p>
          ) : (
            typesQ.data?.map((tp) => (
              <div key={tp.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <span className={`text-sm ${tp.active ? 'text-ink' : 'text-slate-light line-through'}`}>
                  {tp.name}
                </span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="text-sm font-medium text-brand hover:underline"
                    onClick={() => toggleM.mutate(tp)}
                  >
                    {tp.active ? t('expenses.deactivate') : t('expenses.activate')}
                  </button>
                  <ItemActions size="sm" onDelete={() => deleteM.mutate(tp.id)} />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
