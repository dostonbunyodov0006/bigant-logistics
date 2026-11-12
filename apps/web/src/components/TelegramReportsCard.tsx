import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TelegramReportPublic } from '@bigant/shared';
import { api } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { Card, DataTable, EmptyState, ErrorNote, Spinner, type Column } from './ui';
import { TZ } from '../lib/tashkent';

/**
 * Proof photos that have not reached their Telegram group: still being
 * retried, waiting for the bot or the group to be configured, or given up on.
 *
 * Without this the retry endpoint existed but nothing could reach it, so a
 * report that failed every try was simply lost from view.
 */
export function TelegramReportsCard() {
  const { t, i18n } = useTranslation();
  const { data = [], isLoading } = useQuery({
    queryKey: ['telegram-reports', 'failed'],
    queryFn: () => api.get<TelegramReportPublic[]>('/telegram-reports/failed'),
    refetchInterval: 60_000,
  });

  const retryM = useMutation({
    mutationFn: (id: string) => api.post<TelegramReportPublic>(`/telegram-reports/${id}/retry`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['telegram-reports', 'failed'] }),
  });

  const when = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language === 'uz' ? 'uz-UZ' : 'en-GB', {
      timeZone: TZ,
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

  const reason = (r: TelegramReportPublic): string => {
    if (r.last_error === 'telegram_not_configured') return t('telegramReports.notConfigured');
    if (r.status === 'failed') return t('telegramReports.gaveUp');
    return t('telegramReports.willRetry', { time: r.next_attempt_at ? when(r.next_attempt_at) : '—' });
  };

  const columns: Column<TelegramReportPublic>[] = [
    { key: 'created', header: t('telegramReports.colWhen'), render: (r) => when(r.created_at) },
    {
      key: 'target',
      header: t('telegramReports.colGroup'),
      render: (r) => t(`telegramReports.target.${r.target}` as 'telegramReports.target.delivery'),
    },
    {
      key: 'text',
      header: t('telegramReports.colReport'),
      render: (r) => (
        <span className="line-clamp-2 text-sm text-slate">{r.message_text.split('\n')[0]}</span>
      ),
    },
    {
      key: 'why',
      header: t('telegramReports.colWhy'),
      render: (r) => (
        <span className={r.status === 'failed' ? 'text-[#dc2626]' : 'text-slate'}>
          {reason(r)} · {t('telegramReports.tries', { count: r.retry_count })}
        </span>
      ),
    },
    {
      key: 'action',
      header: '',
      render: (r) => (
        <button
          type="button"
          className="rounded-lg border border-[#d8dce3] px-3 py-1 text-sm font-medium text-ink disabled:opacity-50"
          disabled={retryM.isPending}
          onClick={() => retryM.mutate(r.id)}
        >
          {t('telegramReports.retry')}
        </button>
      ),
    },
  ];

  return (
    <Card className="p-5">
      <h2 className="mb-1 text-base font-semibold text-ink">{t('telegramReports.title')}</h2>
      <p className="mb-4 text-sm text-slate">{t('telegramReports.subtitle')}</p>
      {retryM.isError && <ErrorNote error={retryM.error} />}
      {isLoading ? (
        <Spinner />
      ) : data.length === 0 ? (
        <EmptyState title={t('telegramReports.allSent')} hint={t('telegramReports.allSentHint')} />
      ) : (
        <DataTable columns={columns} rows={data} keyOf={(r) => r.id} />
      )}
    </Card>
  );
}
