import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useBottomInset } from '../../lib/useBottomInset';
import { ACTIVE_ORDER_STATUSES, type OrderPublic, type OrderStatus } from '@bigant/shared';
import { ORDERS_LIST_KEY, fetchOrders } from '../../lib/ordersQuery';
import { ActiveOrderCard } from '../../components/ActiveOrderCard';
import { ServiceHomeCards } from '../../components/ServiceHomeCards';
import { ShiftHomeCards } from '../../components/ShiftHomeCards';
import { TripStrip } from '../../components/TripStrip';
import { EmptyState, Spinner } from '../../components/ui';
import { isOrderActionLocked, useOrderActivationClock } from '../../hooks/useOrderActivationClock';
import { useOnShift } from '../../hooks/useShift';

const ACTIVE = ACTIVE_ORDER_STATUSES as readonly OrderStatus[];
const JOURNEY_STARTED = [
  'collecting_items',
  'items_collected',
  'on_the_way',
  'arrived_at_customer',
] as const;
const STARTED = JOURNEY_STARTED as readonly OrderStatus[];

const byArrival = (a: OrderPublic, b: OrderPublic) =>
  a.delivery_datetime.localeCompare(b.delivery_datetime) || a.order_number - b.order_number;

function aboard(all: OrderPublic[], now: number): OrderPublic[] {
  return all.filter((o) => ACTIVE.includes(o.status) && !isOrderActionLocked(o, now));
}

/** Part of a merged po puti trip: the server writes trip positions only then. */
export const inTrip = (o: OrderPublic) =>
  o.delivery_trip_position != null || o.pickup_sources.some((src) => src.trip_position != null);

export function pickCurrent(active: OrderPublic[]): OrderPublic[] {
  // On a co-load the server withholds the action from whichever order's turn it
  // is not — that order would send the driver to the wrong stop. Honour it here
  // rather than showing the furthest-along order regardless.
  const actionable = active.filter((o) => o.next_action.type !== 'waiting_for_trip_stop');
  const pool = actionable.length > 0 ? actionable : active;
  const inProgress = pool.filter((o) => STARTED.includes(o.status)).sort(byArrival);
  const accepted = pool.filter((o) => o.status === 'driver_accepted').sort(byArrival);
  const assigned = pool.filter((o) => o.status === 'assigned_to_driver').sort(byArrival);
  // A return written up at the client comes before the next order (2x zanyat):
  // the driver takes it to the place the seller chose, or sets it aside with
  // "Ojidaniya" and the next order comes up — the return then waits under the
  // yellow banner until he takes it up again. A delivery already under way
  // still comes first.
  const returning = pool.filter((o) => o.status === 'returning' && !o.return_deferred_at).sort(byArrival);
  // A po puti riding with a later order of the queue (owner, 10.11.2026): once
  // its trip is under way, the trip's own orders come before an unrelated one
  // waiting further down the queue.
  const current = inProgress[0] ?? returning[0] ?? accepted.find(inTrip) ?? accepted[0] ?? assigned[0];
  return current ? [current] : [];
}

/**
 * The one order the driver is on right now, from the shared order list.
 *
 * The home screen draws the pinned action bar for it *below* the tab pager,
 * in the screen's own column, so the bar is held above the bottom of the
 * screen by the screen itself — a page inside the pager can grow past the
 * screen's foot, and anything pinned inside it goes with it.
 */
export function useCurrentOrder(): OrderPublic | undefined {
  const { data = [] } = useQuery({
    queryKey: ORDERS_LIST_KEY,
    queryFn: fetchOrders,
    // While a write-up waits for the seller's answer the driver is standing
    // at the client: ask every five seconds then, fifteen otherwise (owner,
    // 03.11.2026). The seller's answer also arrives as a push.
    refetchInterval: (q) =>
      (q.state.data ?? []).some((o) => o.return_items_written > 0 && !o.return_items_confirmed_at && !o.return_items_rejected_at)
        ? 5_000
        : 15_000,
  });
  const now = useOrderActivationClock(data);
  return pickCurrent(aboard(data, now))[0];
}

/** Hozirgi buyurtmam: what to do now. The button to do it is the home
 *  screen's pinned bar, under this pager. */
export function CurrentOrdersTab() {
  const bottomInset = useBottomInset();
  const { t } = useTranslation();
  // Before "Ishni boshladim" the order stays out of sight: the late-start
  // question and the switch are what the screen is about (owner, 09.11.2026).
  const onShift = useOnShift();
  const {
    data = [],
    isLoading,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ORDERS_LIST_KEY,
    queryFn: fetchOrders,
    refetchInterval: 15_000,
  });

  const now = useOrderActivationClock(data);
  const active = aboard(data, now);
  const [current] = pickCurrent(active);
  // Only a co-load needs a route summary, and only while its trip is the one
  // being driven — a po puti riding with a later order shows when that order
  // comes up, not over the order before it (owner, 10.11.2026).
  const showTrip = active.filter((o) => o.status !== 'returning').length > 1 && !!current && inTrip(current);

  if (isLoading) return <Spinner />;

  return (
    <View style={s.screen}>
      <ScrollView
        // With a bar below the pager the bar clears the navigation bar;
        // without one (no order) the scroll content has to.
        contentContainerStyle={[s.content, (!current || !onShift) && { paddingBottom: 20 + bottomInset }]}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
      >
        <ShiftHomeCards />
        <ServiceHomeCards />
        {onShift && showTrip && (
          <View style={s.tripWrap}>
            <TripStrip orders={active} />
          </View>
        )}
        {!onShift ? (
          <EmptyState title={t('home.startToSee')} />
        ) : current ? (
          <ActiveOrderCard order={current} inTrip={showTrip} />
        ) : (
          <EmptyState title={t('home.noCurrent')} />
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingBottom: 20 },
  tripWrap: { paddingHorizontal: 16, paddingTop: 12 },
});
