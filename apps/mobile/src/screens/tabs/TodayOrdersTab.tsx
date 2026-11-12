import { useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { OrderPublic } from '@bigant/shared';
import { api } from '../../lib/api';
import { addDays, tashkentDayKey } from '../../lib/format';
import { OrderRow } from '../../components/OrderRow';
import { EmptyState, Spinner } from '../../components/ui';
import { colors } from '../../components/theme';
import { useOnShift } from '../../hooks/useShift';
import { useBottomInset } from '../../lib/useBottomInset';
import type { RootStackParams } from '../../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParams>;
// Finished work and the day's cancellations are two lists, each under its own
// line (owner, 02.11.2026): an otkaz is not a delivery.
const DONE: OrderPublic['status'][] = ['delivered', 'returned'];
const CANCELLED: OrderPublic['status'][] = ['cancelled'];
/** How far back the tab looks: a month of days, each folded into one row. */
export const PAST_DAYS = 30;
const byNewest = (a: OrderPublic, b: OrderPublic) => b.created_at.localeCompare(a.created_at) || b.order_number - a.order_number;

/** The Tashkent day an order is booked for — not the phone's, which on a
 *  phone set to another zone moved evening orders into tomorrow (owner, 06.11.2026). */
export const ymd = (d: Date) => tashkentDayKey(d);
/** 2026-11-02 → 02.11.2026, the way the office writes a date. */
export const dmy = (day: string) => day.split('-').reverse().join('.');

type Row = { type: 'order'; order: OrderPublic; seq: number } | { type: 'label'; text: string };

export type DayGroup = {
  day: string;
  done: OrderPublic[];
  cancelled: OrderPublic[];
};

/** The day's work, split: today's queue in driving order, then one group per
 *  day (today first), each with what was finished and what was cancelled. */
export function groupDays(orders: OrderPublic[], today: string) {
  const queue = orders
    .filter((o) => ymd(new Date(o.delivery_datetime)) === today && !DONE.includes(o.status) && !CANCELLED.includes(o.status))
    .sort(
      (a, b) =>
        (a.queue_position ?? Number.MAX_SAFE_INTEGER) - (b.queue_position ?? Number.MAX_SAFE_INTEGER) ||
        a.created_at.localeCompare(b.created_at) ||
        a.order_number - b.order_number,
    );
  const byDay = new Map<string, DayGroup>();
  for (const o of orders) {
    const day = ymd(new Date(o.delivery_datetime));
    if (day > today) continue;
    const isDone = DONE.includes(o.status);
    const isCancelled = CANCELLED.includes(o.status);
    // A past day's order that never finished still belongs to that day's row.
    if (!isDone && !isCancelled && day === today) continue;
    const g = byDay.get(day) ?? { day, done: [], cancelled: [] };
    (isCancelled ? g.cancelled : g.done).push(o);
    byDay.set(day, g);
  }
  const days = [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day));
  for (const g of days) {
    g.done.sort(byNewest);
    g.cancelled.sort(byNewest);
  }
  return { queue, days };
}

/** Bugungi buyurtmalar — today's orders as a queue (Navbat), then the finished
 *  work folded by day: today open while the shift runs, every earlier day one
 *  row (02.11.2026) that opens on a tap and closes the one open before it
 *  (owner, 03.11.2026). */
export function TodayOrdersTab({ date }: { date: string }) {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const onShift = useOnShift();
  const from = addDays(date, -PAST_DAYS);
  const yesterday = addDays(date, -1);

  const todayQ = useQuery({
    queryKey: ['orders', 'today', date],
    queryFn: () => api.get<OrderPublic[]>(`/orders?delivery_date=${date}`),
    refetchInterval: 15_000,
  });
  // The earlier days change only when a day ends, so they are asked for less
  // often; one request brings the whole month.
  const pastQ = useQuery({
    queryKey: ['orders', 'past', date],
    queryFn: () => api.get<OrderPublic[]>(`/orders?delivery_date_from=${from}&delivery_date_to=${yesterday}&take=500`),
    refetchInterval: 5 * 60_000,
  });
  const data = [...todayQ.data ?? [], ...pastQ.data ?? []];
  const isLoading = todayQ.isLoading;
  const isRefetching = todayQ.isRefetching;
  const refetch = () => {
    void todayQ.refetch();
    void pastQ.refetch();
  };

  // Every day, today's done work too, starts folded; a tap opens it (owner, 07.11.2026).
  const [openDay, setOpenDay] = useState<string | null>(null);
  useEffect(() => {
    setOpenDay(null);
  }, [onShift, date]);
  // The last rows clear the phone's own buttons, and a day opened by a tap is
  // scrolled up into view instead of unfolding below the screen (owner, 07.11.2026).
  const bottomInset = useBottomInset();
  const listRef = useRef<SectionList<Row, { key: string; day: string | null; open: boolean; title: string; count: number }>>(null);
  const [tapped, setTapped] = useState<string | null>(null);

  if (isLoading) return <Spinner />;

  const { queue, days } = groupDays(data, date);

  if (data.length === 0) {
    return <EmptyState title={t('home.noToday')} />;
  }

  const queueRows: Row[] = queue.map((order, i) => ({ type: 'order', order, seq: i + 1 }));
  const sections = [
    { key: 'queue', day: null as string | null, title: t('home.queue'), count: queue.length, open: true, data: queueRows },
    ...days.map((g) => {
      const open = openDay === g.day;
      const rows: Row[] = [];
      if (open) {
        // Finished: numbered in the order they were finished (newest first, so
        // the first of the day is 1 at the bottom).
        g.done.forEach((order, i) => rows.push({ type: 'order', order, seq: g.done.length - i }));
        if (g.cancelled.length) rows.push({ type: 'label', text: t('home.cancelled') });
        g.cancelled.forEach((order, i) => rows.push({ type: 'order', order, seq: g.cancelled.length - i }));
      }
      const title =
        g.day === date ? (g.done.length ? t('home.completedToday') : t('home.cancelledToday')) : dmy(g.day);
      return { key: g.day, day: g.day, title, count: g.done.length + g.cancelled.length, open, data: rows };
    }),
  ];

  const tappedIndex = tapped ? sections.findIndex((x) => x.day === tapped) : -1;
  return (
    <SectionList
      onContentSizeChange={() => {
        if (tappedIndex < 0) return;
        listRef.current?.scrollToLocation({ sectionIndex: tappedIndex, itemIndex: 0, viewPosition: 0, viewOffset: 64, animated: true });
        setTapped(null);
      }}
      sections={sections}
      keyExtractor={(row) => (row.type === 'order' ? row.order.id : `label-${row.text}`)}
      stickySectionHeadersEnabled={false}
      renderSectionHeader={({ section }) =>
        // No "Navbat · N ta" over the queue (owner, 07.11.2026): the numbered
        // cards say it themselves.
        section.day === null ? null : (
          <View style={section.day === days[0]?.day ? s.firstDay : undefined}>
            <Pressable
              testID={`day-${section.day}`}
              onPress={() => {
                const opening = openDay !== section.day;
                setOpenDay(opening ? section.day : null);
                setTapped(opening ? section.day : null);
              }}
              style={[s.dayHeader, section.day === days[0]?.day && s.dayHeaderFirst, section.open && s.dayHeaderOpen]}
            >
              <Text style={s.dayTitle}>{section.title}</Text>
              <Text style={s.dayCount}>{t('orders.count', { n: section.count })}</Text>
              <Text style={s.chevron}>{section.open ? '⌄' : '›'}</Text>
            </Pressable>
          </View>
        )
      }
      renderItem={({ item, section }) => {
        const row =
          item.type === 'label' ? (
            <Text style={s.subLabel}>{item.text}</Text>
          ) : (
            <OrderRow
              order={item.order}
              seq={item.seq}
              compact={section.key !== 'queue'}
              onPress={() => nav.navigate('OrderDetail', { id: item.order.id })}
            />
          );
        // An open day's orders sit inside its frame, so they read as that
        // day's and not as a list of their own (owner, 07.11.2026).
        return section.key !== 'queue' ? <View style={s.groupBody}>{row}</View> : row;
      }}
      renderSectionFooter={({ section }) =>
        section.key === 'queue' ? (
          section.data.length === 0 ? <Text style={s.emptyRow}>{t('home.noToday')}</Text> : null
        ) : section.open && section.data.length > 0 ? (
          <View style={s.groupEnd} />
        ) : null
      }
      ref={listRef}
      onScrollToIndexFailed={() => undefined}
      contentContainerStyle={{ paddingTop: 8, paddingBottom: 28 + bottomInset }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
    />
  );
}

const s = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 6,
  },
  // What is done is done: a line and some air between it and the work still
  // in hand, so the two are not read as one list.
  sectionDivided: {
    borderTopWidth: 1,
    borderTopColor: colors.mist,
    paddingTop: 16,
    marginTop: 22,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
    color: colors.slate,
  },
  sectionCount: { fontSize: 11, fontWeight: '700', color: colors.slate },
  // One row per day, in its own long rounded frame so it reads as a button
  // (owner, 05.11.2026); the chevron sits at the far end.
  firstDay: {
    borderTopWidth: 1,
    borderTopColor: colors.mist,
    marginHorizontal: 16,
    marginTop: 22,
    paddingTop: 12,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 8,
    paddingVertical: 11,
    paddingHorizontal: 18,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.mist,
    backgroundColor: colors.white,
  },
  dayHeaderFirst: { marginHorizontal: 0, marginTop: 0 },
  // Open: the frame goes on round the day's orders (groupBody, groupEnd).
  dayHeaderOpen: {
    borderColor: colors.brand,
    borderBottomColor: colors.mist,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  groupBody: {
    marginHorizontal: 16,
    borderLeftWidth: 1.5,
    borderRightWidth: 1.5,
    borderColor: colors.brand,
    backgroundColor: colors.white,
  },
  groupEnd: {
    marginHorizontal: 16,
    height: 10,
    borderLeftWidth: 1.5,
    borderRightWidth: 1.5,
    borderBottomWidth: 1.5,
    borderColor: colors.brand,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    backgroundColor: colors.white,
  },
  dayTitle: { flex: 1, fontSize: 15, fontWeight: '800', letterSpacing: 0.3, color: colors.ink },
  dayCount: { fontSize: 13, fontWeight: '700', color: colors.slate },
  chevron: { fontSize: 20, fontWeight: '400', color: colors.slateLt, marginLeft: 4 },
  subLabel: { marginHorizontal: 16, marginTop: 10, marginBottom: 4, fontSize: 11, fontWeight: '800', letterSpacing: 0.7, color: colors.slate },
  emptyRow: { marginHorizontal: 16, marginTop: 4, fontSize: 14, color: colors.slate },
});
