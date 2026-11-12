import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { Card, DataTable, EmptyState, ErrorNote, Spinner, type Column } from './ui';

interface Omborchi {
  id: string;
  telegram_id: string;
  name: string;
  roles: string[];
}

type StaffRole = 'omborchi' | 'dokonchi';
const ROLES: StaffRole[] = ['omborchi', 'dokonchi'];

/** Tick or untick one role, keeping the fixed order (owner, 09.11.2026). */
function toggled(roles: readonly string[], role: StaffRole, on: boolean): StaffRole[] {
  return ROLES.filter((r) => (r === role ? on : roles.includes(r)));
}

/**
 * Who may open the warehouse page (/ombor) from the mini app's bot, by
 * Telegram id (owner, 05.11.2026). They get the new returns and the reminders.
 * (owner, 09.11.2026) One person may hold both roles: each row has a checkbox
 * per role, and adding an id already on the list adds to its roles.
 */
export function OmborchiStaff() {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [tg, setTg] = useState('');
  // (owner, 07.11.2026) The shop's responsible person works the same page for store returns.
  const [roles, setRoles] = useState<StaffRole[]>(['omborchi']);
  const listQ = useQuery({ queryKey: ['ombor', 'staff'], queryFn: () => api.get<Omborchi[]>('/ombor/staff') });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['ombor', 'staff'] });
  const addM = useMutation({
    mutationFn: () => api.post('/ombor/staff', { name: name.trim(), telegram_id: tg.trim(), roles }),
    onSuccess: () => {
      setName('');
      setTg('');
      setRoles(['omborchi']);
      void refresh();
    },
  });
  const rolesM = useMutation({
    mutationFn: (v: { id: string; roles: StaffRole[] }) => api.patch(`/ombor/staff/${v.id}`, { roles: v.roles }),
    onSettled: () => void refresh(),
  });
  const removeM = useMutation({ mutationFn: (id: string) => api.del(`/ombor/staff/${id}`), onSuccess: () => void refresh() });

  const confirmRemove = (r: Omborchi, question: string) => {
    if (window.confirm(question)) removeM.mutate(r.id);
  };

  const onToggle = (r: Omborchi, role: StaffRole, on: boolean) => {
    const next = toggled(r.roles, role, on);
    // (owner, 09.11.2026) The last role is not unticked: it asks to delete the person instead.
    if (!next.length) {
      confirmRemove(r, t('team.omborchiLastRole', { name: r.name }));
      return;
    }
    rolesM.mutate({ id: r.id, roles: next });
  };

  const busy = rolesM.isPending || removeM.isPending;
  const columns: Column<Omborchi>[] = [
    { key: 'name', header: t('team.omborchiName'), render: (r) => <span className="font-medium text-ink">{r.name}</span> },
    { key: 'tg', header: t('team.omborchiTelegram'), render: (r) => <span className="font-mono text-slate">{r.telegram_id}</span> },
    {
      key: 'role',
      header: t('team.omborchiRole'),
      render: (r) => (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {ROLES.map((x) => (
            <label key={x} className="inline-flex items-center gap-1.5 text-ink">
              <input type="checkbox" checked={r.roles.includes(x)} disabled={busy} onChange={(e) => onToggle(r, x, e.target.checked)} />
              {t(`team.role_${x}`)}
            </label>
          ))}
        </div>
      ),
    },
    {
      key: 'x',
      header: '',
      className: 'text-right',
      render: (r) => (
        <button type="button" className="btn-ghost py-1 text-xs text-red-700" disabled={removeM.isPending}
          // (audit, 07.11.2026) One tap took a storekeeper off the list with no question asked.
          onClick={() => confirmRemove(r, t('team.omborchiRemoveConfirm', { name: r.name, defaultValue: "{{name}} ro'yxatdan o'chirilsinmi? U ombor sahifasiga kira olmaydi." }))}>
          {t('common.delete')}
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          <div>
            <label className="field-label" htmlFor="omb-name">{t('team.omborchiName')}</label>
            <input id="omb-name" className="input" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="omb-tg">{t('team.omborchiTelegram')}</label>
            <input id="omb-tg" className="input font-mono" inputMode="numeric" value={tg} maxLength={16} aria-describedby="omb-tg-hint"
              onChange={(e) => setTg(e.target.value.replace(/\D/g, ''))} />
          </div>
          <fieldset>
            <legend className="field-label">{t('team.omborchiRole')}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1 py-2">
              {ROLES.map((x) => (
                <label key={x} className="inline-flex items-center gap-1.5 text-ink">
                  <input type="checkbox" checked={roles.includes(x)} onChange={(e) => setRoles(toggled(roles, x, e.target.checked))} />
                  {t(`team.role_${x}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <button type="button" className="btn-primary" disabled={!name.trim() || tg.length < 4 || !roles.length || addM.isPending} onClick={() => addM.mutate()}>
            {t('team.omborchiAdd')}
          </button>
        </div>
        {/* (owner, 09.11.2026) Where the Telegram id comes from stays in sight. */}
        <p id="omb-tg-hint" className="mt-2 text-xs text-slate">{t('team.omborchiTgHint')}</p>
        {!roles.length ? <p className="mt-1 text-xs text-red-700">{t('team.omborchiRolesNone')}</p> : null}
        {addM.isError ? <ErrorNote error={addM.error} /> : null}
      </Card>
      <Card>
        {rolesM.isError ? <div className="p-3"><ErrorNote error={rolesM.error} /></div> : null}
        {listQ.isLoading ? (
          <Spinner />
        ) : !listQ.data?.length ? (
          <EmptyState title={t('team.omborchiNone')} />
        ) : (
          <DataTable columns={columns} rows={listQ.data} keyOf={(r) => r.id} />
        )}
      </Card>
    </div>
  );
}
