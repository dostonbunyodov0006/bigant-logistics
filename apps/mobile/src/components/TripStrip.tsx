import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { OrderPublic } from '@bigant/shared';
import { Icon } from './Icon';
import { colors } from './theme';

type StopState = 'done' | 'current' | 'pending';

interface TripStop {
  key: string;
  at: number;
  name: string;
  isClient: boolean;
  orderNumber: number;
  state: StopState;
}

/**
 * MARSHRUT — the whole run across a co-load, in driving order.
 *
 * Shown only when more than one order is aboard; one order is the ordinary day
 * and needs no route summary above the card it already has.
 *
 * Every row carries its order number. That is not decoration: two clients'
 * goods are on the truck at once, the number is what is printed on the
 * nakladnoy, and handing the wrong cargo to the wrong person is the mistake
 * this screen exists to prevent. The colour bar is for scanning; the number is
 * what makes it certain, and it survives sunlight and colour blindness.
 */
export function TripStrip({ orders }: { orders: OrderPublic[] }) {
  const { t } = useTranslation();
  const stops = buildTrip(orders);
  if (stops.length === 0) return null;

  return (
    <View style={s.card}>
      <View style={s.head}>
        <Text style={s.title}>{t('trip.title')}</Text>
        <Text style={s.count}>{t('trip.stopCount', { n: stops.length })}</Text>
      </View>

      {stops.map((stop) => {
        const done = stop.state === 'done';
        const current = stop.state === 'current';
        return (
          <View key={stop.key} style={[s.row, current && s.rowCurrent]}>
            <View style={[s.bar, done && s.barDone, current && s.barCurrent]} />
            <View style={[s.dot, done && s.dotDone, current && s.dotCurrent]}>
              {done ? <Icon name="check" size={11} color={colors.onAccent} strokeWidth={3.4} /> : null}
            </View>
            <View style={s.body}>
              <Text style={[s.name, done && s.nameDone, current && s.nameCurrent]} numberOfLines={1}>
                {stop.name}
                {stop.isClient ? <Text style={s.clientTag}> · {t('trip.client')}</Text> : null}
              </Text>
              {current ? <Text style={s.now}>{t('trip.now')}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/**
 * Merges every aboard order's remaining stops into one list ordered by trip
 * position — the same sequence the driver's buttons follow, because both read
 * the positions the server wrote when the co-load was accepted.
 *
 * Exported so the sequence can be asserted independently of the view.
 */
export function buildTrip(orders: OrderPublic[]): TripStop[] {
  const stops: TripStop[] = [];

  for (const order of orders) {
    for (const src of order.pickup_sources) {
      if (src.trip_position == null) continue;
      stops.push({
        key: src.id,
        at: src.trip_position,
        name: src.name,
        isClient: false,
        orderNumber: order.order_number,
        state: src.leg_status === 'arrived' ? 'done' : 'pending',
      });
    }
    if (order.delivery_trip_position == null) continue;
    const delivered = order.status === 'delivered' || order.status === 'returned';
    stops.push({
      key: `${order.id}:client`,
      at: order.delivery_trip_position,
      name: order.client_name,
      isClient: true,
      orderNumber: order.order_number,
      state: delivered ? 'done' : 'pending',
    });
  }

  stops.sort((a, b) => a.at - b.at);
  // The first stop still outstanding is the one being driven to now. Marking it
  // here rather than trusting each order's own status keeps the strip and the
  // card agreeing about where the driver is.
  const next = stops.find((stop) => stop.state === 'pending');
  if (next) next.state = 'current';
  return stops;
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.white, borderRadius: 16, padding: 13, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  title: { fontSize: 10, fontWeight: '800', color: colors.slate, letterSpacing: 0.7 },
  count: { fontSize: 10, fontWeight: '700', color: colors.slate },
  row: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  rowCurrent: {
    backgroundColor: colors.brandTint,
    borderRadius: 9,
    paddingVertical: 7,
    paddingHorizontal: 8,
    marginHorizontal: -8,
  },
  bar: { width: 3, height: 26, borderRadius: 99, backgroundColor: colors.mist },
  barDone: { backgroundColor: colors.success },
  barCurrent: { backgroundColor: colors.brand },
  dot: {
    width: 19,
    height: 19,
    borderRadius: 99,
    borderWidth: 2,
    borderColor: colors.mist,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotDone: { backgroundColor: colors.success, borderColor: colors.success },
  dotCurrent: { backgroundColor: colors.brand, borderColor: colors.brand },
  body: { flex: 1 },
  name: { fontSize: 13, fontWeight: '700', color: colors.graphite },
  nameDone: { fontWeight: '600', color: colors.slate, textDecorationLine: 'line-through' },
  nameCurrent: { fontSize: 14, fontWeight: '800', color: colors.ink },
  clientTag: { fontWeight: '600', color: colors.slate },
  now: { fontSize: 10, fontWeight: '800', color: colors.brandDark, letterSpacing: 0.4, marginTop: 1 },
  orderNo: { fontSize: 11, fontWeight: '800', color: colors.slate },
  orderNoCurrent: { color: colors.brandDark },
});
