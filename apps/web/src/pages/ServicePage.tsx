import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ServiceSummary } from '@bigant/shared';
import { api } from '../lib/api';
import { PageHeader, Tabs } from '../components/ui';
import { ServiceDueTab } from './service/ServiceDueTab';
import { ServiceRequestsTab } from './service/ServiceRequestsTab';
import { ServiceVisitsTab } from './service/ServiceVisitsTab';
import { ServiceCatalogTab } from './service/ServiceCatalogTab';
import { ServiceCentersTab } from './service/ServiceCentersTab';
import { ymd } from './fuel/fuelShared';
import type { Period } from './FuelPage';
import { tkMonthStart } from '../lib/tashkent';

type Tab = 'due' | 'requests' | 'visits' | 'catalog' | 'centers';

function thisMonth(): Period {
  const now = new Date();
  return { from: tkMonthStart(), to: ymd(now) };
}

/**
 * The truck's upkeep, from the office: what is coming due, who asked to go,
 * what was done and paid, and the two lists behind it all — the works and
 * the centres. Counts on the first two tabs are live; the rest is the ledger.
 */
/** `embedded`: shown as a tab of Transport, which carries the heading. */
export function ServicePage({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('due');
  const [period, setPeriod] = useState<Period>(thisMonth);

  const summaryQ = useQuery({
    queryKey: ['service', 'summary', 'live'],
    queryFn: () => api.get<ServiceSummary>('/service/summary'),
    refetchInterval: 60_000,
  });
  const s = summaryQ.data;
  const dueCount = (s?.overdue ?? 0) + (s?.due_soon ?? 0);
  const withCount = (label: string, n: number) => (n > 0 ? `${label} · ${n}` : label);

  return (
    <div>
      {!embedded && <PageHeader title={t('service.title')} subtitle={t('service.subtitle')} />}
      <Tabs<Tab>
        active={tab}
        onChange={setTab}
        tabs={[
          { value: 'due', label: withCount(t('service.tabDue'), dueCount) },
          { value: 'requests', label: withCount(t('service.tabRequests'), s?.pending_requests ?? 0) },
          { value: 'visits', label: withCount(t('service.tabVisits'), s?.pending_review ?? 0) },
          { value: 'catalog', label: t('service.tabCatalog') },
          { value: 'centers', label: t('service.tabCenters') },
        ]}
      />
      {tab === 'due' && <ServiceDueTab summary={s} />}
      {tab === 'requests' && <ServiceRequestsTab />}
      {tab === 'visits' && <ServiceVisitsTab period={period} onPeriod={setPeriod} />}
      {tab === 'catalog' && <ServiceCatalogTab />}
      {tab === 'centers' && <ServiceCentersTab period={period} />}
    </div>
  );
}
