import { useTranslation } from 'react-i18next';
import type { OrderStats } from '@bigant/shared';
import { Card } from './ui';

/** Compact status-count tiles, reused by dashboards and per-entity detail pages. */
export function StatsStrip({ stats }: { stats?: OrderStats }) {
  const { t } = useTranslation();
  const counts = stats?.counts ?? {};
  const total = stats?.total ?? 0;

  const tiles = [
    { label: t('dashboard.totalOrders'), value: total, fg: '#14181f' },
    {
      label: t('dashboard.inProgress'),
      value: total - (counts.delivered ?? 0) - (counts.cancelled ?? 0),
      fg: '#b94e06',
    },
    { label: t('dashboard.problem'), value: counts.problem ?? 0, fg: '#dc2626' },
    { label: t('dashboard.delivered'), value: counts.delivered ?? 0, fg: '#15803d' },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {tiles.map((tile) => (
        <Card key={tile.label} className="p-5">
          <div className="font-mono text-3xl font-semibold" style={{ color: tile.fg }}>
            {tile.value}
          </div>
          <div className="mt-1 text-sm text-slate">{tile.label}</div>
        </Card>
      ))}
    </div>
  );
}
