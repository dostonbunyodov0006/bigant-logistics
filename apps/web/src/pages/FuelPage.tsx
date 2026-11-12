import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { FuelSummary } from '@bigant/shared';
import { api } from '../lib/api';
import { PageHeader, Tabs } from '../components/ui';
import { FuelLogsTab } from './fuel/FuelLogsTab';
import { FuelReviewTab } from './fuel/FuelReviewTab';
import { FuelReconcileTab } from './fuel/FuelReconcileTab';
import { FuelSettleTab } from './fuel/FuelSettleTab';
import { FuelStationsTab } from './fuel/FuelStationsTab';
import { ymd } from './fuel/fuelShared';
import { tkMonthStart } from '../lib/tashkent';

export type Period = { from: string; to: string };
type Tab = 'logs' | 'review' | 'settle' | 'reconcile' | 'stations';

/** The first of this month to today — what the invoice and the cash both cover. */
function thisMonth(): Period {
  const now = new Date();
  return { from: tkMonthStart(), to: ymd(now) };
}

/**
 * One page for the whole fuel ledger. The period is shared across tabs so
 * "September" means the same thing in the logs, the station totals and the
 * station counts.
 */
/** `embedded`: shown as a tab of Xarajatlar, which carries the heading. */
export function FuelPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useTranslation();
  // The tab is in the link (?tab=settle) so coming back from a driver's
  // refund page lands on the tab it was opened from.
  const [params, setParams] = useSearchParams();
  const TABS: Tab[] = ['logs', 'review', 'settle', 'reconcile', 'stations'];
  const tab: Tab = TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'logs';
  const bolim = params.get('bolim');
  const setTab = (next: Tab) =>
    setParams({ ...(bolim ? { bolim } : {}), ...(next === 'logs' ? {} : { tab: next }) }, { replace: true });
  const [period, setPeriod] = useState<Period>(thisMonth);

  // The review count on the tab is not scoped to the period on purpose: a
  // fill-up from last month that nobody settled is still waiting.
  const pendingQ = useQuery({
    queryKey: ['fuel', 'summary', 'pending'],
    queryFn: () => api.get<FuelSummary>('/fuel/summary'),
    refetchInterval: 60_000,
  });
  const pending = pendingQ.data?.pending_review ?? 0;

  return (
    <div>
      {!embedded && <PageHeader title={t('fuel.title')} />}
      <Tabs<Tab>
        active={tab}
        onChange={setTab}
        tabs={[
          { value: 'logs', label: t('fuel.tabLogs') },
          {
            value: 'review',
            label: pending > 0 ? `${t('fuel.tabReview')} · ${pending}` : t('fuel.tabReview'),
          },
          { value: 'settle', label: t('fuel.tabSettle') },
          { value: 'reconcile', label: t('fuel.tabReconcile') },
          { value: 'stations', label: t('fuel.tabStations') },
        ]}
      />
      {tab === 'logs' && <FuelLogsTab period={period} onPeriod={setPeriod} />}
      {tab === 'review' && <FuelReviewTab />}
      {tab === 'settle' && <FuelSettleTab period={period} />}
      {tab === 'reconcile' && <FuelReconcileTab period={period} />}
      {tab === 'stations' && <FuelStationsTab period={period} />}
    </div>
  );
}
