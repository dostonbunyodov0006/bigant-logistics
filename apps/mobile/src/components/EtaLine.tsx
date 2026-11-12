import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { OrderEta, OrderPublic } from '@bigant/shared';
import { useOrderEta } from '../hooks/useOrderEta';
import { colors } from './theme';
import { Icon } from './Icon';

/**
 * "Bozor B — ~12 daqiqa · 6.4 km", with the rest of the run underneath.
 *
 * It sits inside the pinned action bar now rather than in a tinted box of its
 * own: it answers "how far is the thing this button sends me to", so it belongs
 * against the button, not in the scroll.
 *
 * Three faces:
 *  - ok:          the number, plainly
 *  - stale:       greyed, with how old the position is — a week-old position is
 *                 still shown, but never presented as live
 *  - unavailable: nothing, except a hint when the driver's own phone is not
 *                 reporting (location permission off)
 */
export function EtaLine({ order }: { order: OrderPublic }) {
  const { t } = useTranslation();
  const q = useOrderEta(order);
  const eta = q.data;
  if (!eta) return null;

  if (eta.state === 'unavailable') {
    if (eta.reason === 'no_driver_position') {
      return <Text style={s.hint}>{t('eta.enableLocation')}</Text>;
    }
    return null;
  }

  const stop = eta.next_stop;
  if (!stop) return null;
  const stale = eta.state === 'stale';

  // The next stop is a pickup with a phone: a call at the line's right end, to
  // ring the person there before he arrives (owner, 11.11.2026).
  const pickupPhone =
    stop.kind === 'pickup' && stop.pickup_source_id
      ? (order.pickup_sources.find((src) => src.id === stop.pickup_source_id)?.phone_number ?? null)
      : null;
  const dialable = pickupPhone?.replace(/[^\d+]/g, '') || null;

  return (
    <View style={s.wrap}>
      <View style={s.row}>
        <Text style={[s.main, stale && s.mainStale, s.flex]} numberOfLines={1}>
          {t('eta.toStop', { name: stop.name, min: minutes(stop.eta_seconds), km: km(stop.distance_km) })}
        </Text>
        {dialable ? (
          <Pressable
            onPress={() => void Linking.openURL(`tel:${dialable}`)}
            accessibilityRole="button"
            accessibilityLabel={t('orders.callPickup', { name: stop.name })}
            hitSlop={8}
            style={({ pressed }) => [s.call, pressed && { opacity: 0.7 }]}
          >
            <Icon name="phone" size={18} color={colors.onAccent} strokeWidth={2.2} />
          </Pressable>
        ) : null}
      </View>
      {/* Only the next stop: the sklad until he has loaded, then the client.
          The whole-route line under it is gone (owner, 28.10.2026). */}
      {stale && eta.driver_position ? (
        <Text style={s.sub}>{t('eta.lastSeen', { ago: ago(eta.driver_position.age_seconds, t) })}</Text>
      ) : null}
    </View>
  );
}

/** Just the whole-journey figure, for the new-assignment card: accepting is a
 *  decision, and how far the job is belongs in it. */
export function EtaTotal({ order }: { order: OrderPublic }) {
  const { t } = useTranslation();
  const eta = useOrderEta(order).data;
  const total = eta?.state === 'ok' ? (eta.trip_total ?? eta.delivery) : null;
  if (!total) return null;
  return (
    <Text style={s.total}>
      {t('eta.jobTotal', { min: minutes(total.eta_seconds), km: km(total.distance_km) })}
    </Text>
  );
}

export function minutes(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}

export function km(value: number): string {
  return value < 10 ? value.toFixed(1) : String(Math.round(value));
}

type T = (key: string, opts?: Record<string, unknown>) => string;
export function ago(seconds: number, t: T): string {
  if (seconds < 60) return t('eta.justNow');
  if (seconds < 3600) return t('eta.minutesAgo', { n: Math.round(seconds / 60) });
  if (seconds < 86_400) return t('eta.hoursAgo', { n: Math.round(seconds / 3600) });
  return t('eta.daysAgo', { n: Math.round(seconds / 86_400) });
}

const s = StyleSheet.create({
  wrap: { gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1 },
  call: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' },
  main: { fontSize: 15, fontWeight: '800', color: colors.brandDark },
  mainStale: { color: colors.slate },
  sub: { fontSize: 12, fontWeight: '600', color: colors.slate },
  hint: { fontSize: 12, fontWeight: '600', color: colors.slate },
  total: { fontSize: 14, fontWeight: '800', color: colors.graphite },
});

export type { OrderEta };
