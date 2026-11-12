import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type {
  DocumentExpiryStats,
  ExpiringDocument,
  OrderPage,
  OrderStats,
  OrderStatus,
} from '@bigant/shared';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { ORDER_STATUS_TONE, StatusBadge } from '../components/StatusBadge';
import { Card, EmptyState, Spinner } from '../components/ui';
import { Pager } from '../components/Pager';
import { tkInput, tkYmd } from '../lib/tashkent';
import { ShiftAlertsCard } from '../components/ShiftCheck';

/** Expiring documents / recent orders shown per page in the dashboard boxes. */
const DOC_PAGE = 5;
const RECENT_PAGE = 5;

function ExpiringDocRow({ doc }: { doc: ExpiringDocument }) {
  const { t } = useTranslation();
  const to = doc.owner_type === 'vehicle' ? `/vehicles/${doc.owner_id}` : `/drivers/${doc.owner_id}`;
  const typeKey =
    doc.owner_type === 'vehicle'
      ? `vehicleDocType.${doc.doc_type}`
      : `driverDocType.${doc.doc_type}`;
  // Dynamic key (doc_type is a plain string from the API) — bypass the typed t().
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docTypeLabel = (t as any)(typeKey) as string;
  const isExpired = doc.status === 'expired';
  return (
    <Link
      to={to}
      className="flex items-center justify-between gap-4 px-4 py-3 transition hover:bg-paper/60"
    >
      <div className="min-w-0">
        <div className="font-medium text-ink">{doc.owner_label}</div>
        <div className="mt-0.5 text-sm text-slate">{docTypeLabel}</div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            isExpired ? 'bg-[#fdeaea] text-[#dc2626]' : 'bg-[#fef6e7] text-[#a15c07]'
          }`}
        >
          {isExpired ? t('dashboard.docExpired') : t('dashboard.docExpiringSoon')}
        </span>
        <span className="font-mono text-xs text-slate-light">
          {isExpired
            ? t('dashboard.docDaysOverdue', { days: Math.abs(doc.days_until_expiry) })
            : t('dashboard.docDaysLeft', { days: doc.days_until_expiry })}
        </span>
      </div>
    </Link>
  );
}

/**
 * The day's orders, step by step, in the words the admin uses (owner,
 * 06.11.2026): the bare status names ("Yo'lda") did not say whose move it is.
 */
const PIPELINE = [
  'created',
  'assigned_to_driver',
  'driver_accepted',
  'collecting_items',
  'items_collected',
  'on_the_way',
  'arrived_at_customer',
  'delivered',
] as const satisfies readonly OrderStatus[];

/** Where a number leads: the orders list, filtered to exactly what was counted. */
function ordersLink(day: string, status?: string): string {
  const q = new URLSearchParams({ sana: day });
  if (status) q.set('status', status);
  return `/orders?${q.toString()}`;
}

const UZ_MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * "6-noyabr" / "6-noyabr, 16:10", in Tashkent (owner, 06.11.2026): the
 * browser's own Uzbek showed "M11 6" and its dates came out in Russian.
 */
function dayWords(at: Date | string, lang: string, withTime = false): string {
  const ymd = tkYmd(at);
  const m = Number(ymd.slice(5, 7)) - 1;
  const d = Number(ymd.slice(8, 10));
  const day = lang.startsWith('uz') ? `${d}-${UZ_MONTHS[m]}` : `${d} ${EN_MONTHS[m]}`;
  if (!withTime) return day;
  return `${day}, ${tkInput(at).slice(11, 16)}`;
}

function Chevron() {
  return (
    <span aria-hidden className="text-lg leading-none text-slate-light transition group-hover:translate-x-0.5 group-hover:text-brand">
      ›
    </span>
  );
}

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  // The compliance endpoint is admin/manager-only; skip the request for others.
  const canSeeCompliance = user?.role === 'admin' || user?.role === 'manager';
  // Today's orders, by Tashkent's day (owner, 06.11.2026): the all-time totals
  // only ever grew and told nothing about the day.
  const today = tkYmd();
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['orders', 'stats', today],
    queryFn: () => api.get<OrderStats>(`/orders/stats?delivery_date=${today}`),
    // SSE keeps this live; the slow interval is only a reconnect/token-refresh safety net.
    refetchInterval: 60_000,
  });
  const { data: expiry } = useQuery({
    queryKey: ['compliance', 'expiring'],
    queryFn: () => api.get<DocumentExpiryStats>('/compliance/expiring'),
    enabled: canSeeCompliance,
    refetchInterval: 60_000,
  });
  const [docPage, setDocPage] = useState(0);
  const [recentPage, setRecentPage] = useState(0);
  const { data: recentData, isLoading: recentLoading } = useQuery({
    queryKey: ['orders', 'page', 'recent', recentPage],
    queryFn: () =>
      api.get<OrderPage>(`/orders/page?skip=${recentPage * RECENT_PAGE}&take=${RECENT_PAGE}`),
    // SSE keeps this live; the slow interval is only a reconnect/token-refresh safety net.
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
  const isLoading = statsLoading || recentLoading;

  // Document expiry (client-side paging over the compliance list).
  const docsList = expiry?.documents ?? [];
  const docPages = Math.max(1, Math.ceil(docsList.length / DOC_PAGE));
  const docSafe = Math.min(docPage, docPages - 1);
  const docRows = docsList.slice(docSafe * DOC_PAGE, docSafe * DOC_PAGE + DOC_PAGE);
  const showDocExpiry = canSeeCompliance && !!expiry && expiry.total > 0;

  // Recent orders (server-side paging).
  const recentItems = recentData?.items ?? [];
  const recentTotal = recentData?.total ?? 0;
  const recentPages = Math.max(1, Math.ceil(recentTotal / RECENT_PAGE));

  const counts = stats?.counts ?? {};
  const total = stats?.total ?? 0;
  const delivered = counts.delivered ?? 0;
  const problem = counts.problem ?? 0;

  // Delivered is a number above; the steps are the ones still under way.
  const steps = PIPELINE.filter((stage) => stage !== 'delivered')
    .map((stage) => ({ stage, n: counts[stage] ?? 0 }))
    .filter((x) => x.n > 0);

  const tiles = [
    { label: t('dashboard.todayTotal'), value: total, fg: undefined, to: ordersLink(today) },
    { label: t('dashboard.todayOpen'), value: total - delivered - (counts.cancelled ?? 0), fg: '#b94e06', to: ordersLink(today) },
    { label: t('dashboard.problem'), value: problem, fg: problem > 0 ? '#dc2626' : undefined, to: ordersLink(today, 'problem') },
    { label: t('dashboard.delivered'), value: delivered, fg: '#15803d', to: ordersLink(today, 'delivered') },
  ];

  return (
    <div>
      {isLoading ? (
        <Card>
          <Spinner />
        </Card>
      ) : (
        <>
          <Card className="p-5">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-lg font-semibold">
                {t('dashboard.todayTitle', { date: dayWords(new Date(), i18n.language) })}
              </h2>
              <Link to={ordersLink(today)} className="text-sm font-medium text-brand hover:text-brand-dark">
                {t('dashboard.todayAll')}
              </Link>
            </div>

            {total === 0 ? (
              // Twelve zeros said nothing (owner, 06.11.2026): an empty day is one sentence.
              <div className="rounded-xl border border-dashed border-mist px-4 py-6 text-center text-slate">
                {t('dashboard.todayNone')}
              </div>
            ) : (
              <>
                {/* The four numbers of the day; each opens the orders it counts. */}
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {tiles.map((tile) => (
                    <Link
                      key={tile.label}
                      to={tile.to}
                      className="group rounded-xl border border-mist p-4 transition hover:border-brand/50 hover:bg-paper/60"
                    >
                      <div className="flex items-start justify-between">
                        <div className="font-mono text-3xl font-semibold text-ink" style={tile.fg ? { color: tile.fg } : undefined}>
                          {tile.value}
                        </div>
                        <Chevron />
                      </div>
                      <div className="mt-1 text-sm font-medium text-slate">{tile.label}</div>
                    </Link>
                  ))}
                </div>

                {/* Where today's open orders stand: only the steps that hold some, in the order they go. */}
                {steps.length > 0 && (
                  <>
                    <div className="mb-2 mt-5 text-sm font-semibold text-ink">{t('dashboard.stepsTitle')}</div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {steps.map(({ stage, n }) => (
                        <Link
                          key={stage}
                          to={ordersLink(today, stage)}
                          className="group flex items-center justify-between gap-3 rounded-lg border border-mist px-3 py-2 transition hover:border-brand/50 hover:bg-paper/60"
                        >
                          <span className="text-sm text-ink">{t(`dashboard.step.${stage}`)}</span>
                          <span className="flex items-center gap-2">
                            <span className="font-mono text-lg font-semibold" style={{ color: ORDER_STATUS_TONE[stage].fg }}>
                              {t('dashboard.pieces', { n })}
                            </span>
                            <Chevron />
                          </span>
                        </Link>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </Card>

          {canSeeCompliance && <ShiftAlertsCard />}

          <div className={`mt-6 grid gap-4 ${showDocExpiry ? 'lg:grid-cols-2' : ''}`}>
            {showDocExpiry && (
              <div className="flex flex-col">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-lg font-semibold">{t('dashboard.docExpiry')}</h2>
                  {expiry!.expired_count > 0 && (
                    <span className="rounded-full bg-[#fdeaea] px-2 py-0.5 text-xs font-semibold text-[#dc2626]">
                      {expiry!.expired_count} {t('dashboard.docExpired').toLowerCase()}
                    </span>
                  )}
                  {expiry!.soon_count > 0 && (
                    <span className="rounded-full bg-[#fef6e7] px-2 py-0.5 text-xs font-semibold text-[#a15c07]">
                      {expiry!.soon_count} {t('dashboard.docExpiringSoon').toLowerCase()}
                    </span>
                  )}
                </div>
                <Card className="flex flex-1 flex-col">
                  <div className="flex-1 divide-y divide-mist/60">
                    {docRows.map((doc) => (
                      <ExpiringDocRow key={`${doc.owner_type}-${doc.id}`} doc={doc} />
                    ))}
                  </div>
                  <div className="px-4 pb-3">
                    <Pager page={docSafe} count={docPages} onPage={setDocPage} size="lg" />
                  </div>
                </Card>
              </div>
            )}

            <div className="flex flex-col">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-display text-lg font-semibold">{t('dashboard.recentOrders')}</h2>
                <Link to="/orders" className="text-sm font-medium text-brand hover:text-brand-dark">
                  {t('dashboard.viewAll')}
                </Link>
              </div>
              <Card className="flex flex-1 flex-col">
                {recentItems.length === 0 ? (
                  <EmptyState title={t('dashboard.noOrders')} hint={t('dashboard.noOrdersHint')} />
                ) : (
                  <>
                    <div className="flex-1 divide-y divide-mist/60">
                      {recentItems.map((o) => (
                        // A row opens its order (owner, 06.11.2026).
                        <Link
                          key={o.id}
                          to={`/orders/${o.id}`}
                          className="group flex items-center justify-between gap-4 px-4 py-3 transition hover:bg-paper/60"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-medium text-ink">{o.client_name}</div>
                            {o.assigned_driver_name && (
                              <div className="truncate text-xs text-slate">{o.assigned_driver_name}</div>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-3">
                            <span className="hidden text-sm text-slate sm:inline">
                              {o.delivery_datetime ? dayWords(o.delivery_datetime, i18n.language, true) : '—'}
                            </span>
                            <StatusBadge status={o.status} />
                            <Chevron />
                          </div>
                        </Link>
                      ))}
                    </div>
                    <div className="px-4 pb-3">
                      <Pager page={recentPage} count={recentPages} onPage={setRecentPage} size="lg" />
                    </div>
                  </>
                )}
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
