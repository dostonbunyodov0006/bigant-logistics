import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { NotificationPublic } from '@bigant/shared';
import { api } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { formatDateTime } from '../lib/format';

/** `label`: drawn as a full-width row (inside the header's gear menu) rather than an icon. */
export function NotificationsBell({ label }: { label?: string } = {}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

  const unread = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api.get<{ unread: number }>('/notifications/unread-count'),
    refetchInterval: 20_000,
  });
  const list = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => api.get<NotificationPublic[]>('/notifications'),
    enabled: open,
  });
  const markRead = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const markAllRead = useMutation({
    mutationFn: () => api.patch('/notifications/read-all'),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const count = unread.data?.unread ?? 0;

  function openItem(n: NotificationPublic) {
    if (!n.read_at) {
      markRead.mutate(n.id);
    }
    if (n.related_order_id) {
      setOpen(false);
      navigate(`/orders/${n.related_order_id}`);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={
          label
            ? 'relative flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink transition hover:bg-paper'
            : 'relative rounded-lg p-2 text-slate transition hover:bg-paper hover:text-ink'
        }
        aria-label={t('notifications.title')}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {label && <span className="flex-1">{label}</span>}
        {count > 0 && (
          <span className={`${label ? 'relative' : 'absolute right-0.5 top-0.5'} flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 font-mono text-[10px] font-semibold text-white`}>
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-mist bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-mist px-4 py-3">
              <span className="font-display text-sm font-semibold">{t('notifications.title')}</span>
              {count > 0 && (
                <button
                  type="button"
                  onClick={() => markAllRead.mutate()}
                  className="rounded p-1 text-slate transition hover:bg-paper hover:text-ink"
                  aria-label={t('notifications.markAllRead')}
                  title={t('notifications.markAllRead')}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 12l5 5L18 6" />
                    <path d="M7 12l5 5L23 6" />
                  </svg>
                </button>
              )}
            </div>
            <div className="max-h-96 overflow-auto">
              {list.isLoading ? (
                <div className="p-4 text-sm text-slate">{t('notifications.loading')}</div>
              ) : (list.data?.length ?? 0) === 0 ? (
                <div className="p-6 text-center text-sm text-slate">{t('notifications.allCaughtUp')}</div>
              ) : (
                list.data?.map((n) => {
                  const titleKey = `notificationType.${n.type}.title`;
                  const bodyKey = `notificationType.${n.type}.body`;
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const tf = t as any;
                  const title: string = i18n.exists(titleKey) ? tf(titleKey) : n.title;
                  const body: string = i18n.exists(bodyKey) ? tf(bodyKey, { client: n.client_name ?? t('orders.colClient') }) : n.body;
                  return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => openItem(n)}
                    className="flex w-full items-start gap-2 border-b border-mist/60 px-4 py-3 text-left transition last:border-0 hover:bg-paper/60"
                  >
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? 'bg-transparent' : 'bg-brand'}`}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink">{title}</span>
                      <span className="block text-sm text-slate">{body}</span>
                      <span className="mt-0.5 block font-mono text-xs text-slate-light">
                        {formatDateTime(n.created_at)}
                      </span>
                    </span>
                  </button>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
