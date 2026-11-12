import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { OrderPublic } from '@bigant/shared';
import { formatTime, startSlotKey } from '../lib/format';
import { StatusBadge } from './ui';
import { Icon } from './Icon';
import { colors } from './theme';
import { useCurrentOrder } from '../screens/tabs/CurrentOrdersTab';

/**
 * One order in Bugungi / Ertangi.
 *
 * This is a planning card, not a working one: it answers where the job is, what
 * it is, and when — the things a driver scans a day by. The two full-width
 * green call buttons that used to sit on every row are down to one compact
 * button for the seller who booked the job, because that is the call a driver
 * actually places from a list.
 */
export function OrderRow({
  order,
  onPress,
  disabled = false,
  compact = false,
  seq,
}: {
  order: OrderPublic;
  onPress: () => void;
  /** Its place in today's queue, 1, 2, 3 — the order he will drive them in. */
  seq?: number;
  /** Actions are not yet unlocked (`actions_available_at` in the future). */
  disabled?: boolean;
  /** Finished today: one quiet line, so the queue stays the thing you read. */
  compact?: boolean;
}) {
  const { t } = useTranslation();

  if (compact) {
    const cancelled = order.status === 'cancelled';
    return (
      <Pressable onPress={onPress} style={s.doneRow} accessibilityRole="button">
        {/* The day's done work is numbered in the order it was finished: 1, 2, 3. */}
        <View style={[s.doneMark, seq != null && s.doneMarkNum, cancelled && s.doneMarkOff]}>
          {seq != null ? (
            <Text style={[s.doneSeq, cancelled && s.doneSeqOff]}>{seq}</Text>
          ) : cancelled ? null : (
            <Icon name="check" size={11} color={colors.onAccent} strokeWidth={3.2} />
          )}
        </View>
        <Text style={s.doneNum}>{t('home.clientLabel')}</Text>
        <Text style={s.doneName} numberOfLines={1}>
          {order.client_name}
        </Text>
        <Text style={s.doneTime}>{formatTime(order.delivery_datetime)}</Text>
      </Pressable>
    );
  }

  const where = [order.district_name, order.client_address].filter(Boolean).join(' · ');
  const cargo = [
    order.cargo_type_name,
    order.weight_kg != null ? `${order.weight_kg} kg` : null,
    t('orders.stopsCount', { n: order.pickup_sources.length }),
  ]
    .filter(Boolean)
    .join(' · ');
  const urgent = order.priority === 'urgent';
  const seller = order.created_by_seller_name?.trim().split(/\s+/)[0] ?? null;
  const sellerPhone = order.created_by_seller_phone_number?.trim().replace(/[^\d+]/g, '') ?? '';
  // Not while another order is under way: that one is the call to make.
  const current = useCurrentOrder();
  const canCall = /\d/.test(sellerPhone) && !(current && current.id !== order.id);

  return (
    <Pressable
      // A locked order still opens: he reads it all, he just cannot act on it yet.
      onPress={onPress}
      accessibilityRole="button"
      style={s.card}
    >
      <View style={s.head}>
        {seq != null ? (
          <View style={s.seq}>
            <Text style={s.seqText}>{seq}</Text>
          </View>
        ) : (
          <View style={s.num}>
            <Text style={[s.numText, disabled && s.muted]}>{t('home.clientLabel')}</Text>
          </View>
        )}
        <Text style={[s.time, urgent && !disabled && s.timeUrgent, disabled && s.muted]}>
          {startSlotKey(order) ? t(startSlotKey(order)!) : formatTime(order.delivery_datetime)}
        </Text>
        {urgent && !disabled ? (
          <View style={s.urgent}>
            <Text style={s.urgentText}>{t('priority.urgent')}</Text>
          </View>
        ) : null}
        <View style={{ flex: 1 }} />
        {/* Locked rows say why instead of showing a status the driver cannot
            act on — and stay at full contrast rather than fading out. */}
        {disabled ? (
          <View style={s.lock}>
            <Icon name="lock" size={13} color={colors.slate} strokeWidth={2.4} />
          </View>
        ) : (
          <StatusBadge status={order.status} />
        )}
      </View>

      <Text style={[s.client, disabled && s.clientMuted]} numberOfLines={1}>
        {order.client_name}
      </Text>
      {where ? (
        <Text style={s.where} numberOfLines={1}>
          {where}
        </Text>
      ) : null}

      <View style={s.footer}>
        <Icon name="box" size={14} color={colors.slate} />
        <Text style={s.cargo} numberOfLines={1}>
          {cargo || '—'}
        </Text>
        {canCall && (
          <Pressable
            onPress={() => void Linking.openURL(`tel:${sellerPhone}`)}
            accessibilityRole="button"
            accessibilityLabel={t('orders.callSeller')}
            hitSlop={6}
            style={s.call}
          >
            <Icon name="phone" size={13} color={colors.success} strokeWidth={2.2} />
            <Text style={s.callText} numberOfLines={1}>
              {seller ?? t('orders.seller')}
            </Text>
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 9,
    borderRadius: 14,
    backgroundColor: colors.white,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  num: { borderRadius: 7, backgroundColor: colors.chip, paddingHorizontal: 8, paddingVertical: 3 },
  // The queue number: a black disc, read before anything else on the row.
  seq: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  seqText: { fontSize: 17, fontWeight: '900', color: colors.onAccent },
  numText: { fontSize: 13, fontWeight: '800', color: colors.graphite },
  time: { fontSize: 14, fontWeight: '800', color: colors.graphite },
  timeUrgent: { color: colors.brandDark },
  muted: { color: colors.slate },
  urgent: { borderRadius: 99, backgroundColor: colors.brandTint, paddingHorizontal: 9, paddingVertical: 3 },
  urgentText: { fontSize: 10, fontWeight: '800', color: colors.brandDark },
  lock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 99,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.mist,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  lockText: { fontSize: 10, fontWeight: '800', color: colors.slate },
  client: { marginTop: 7, fontSize: 17, fontWeight: '800', color: colors.ink },
  clientMuted: { color: colors.graphite },
  where: { marginTop: 3, fontSize: 13, fontWeight: '600', color: colors.slate },
  footer: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.mist,
    paddingTop: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cargo: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.graphite },
  call: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: colors.success,
    backgroundColor: colors.successBg,
    paddingHorizontal: 11,
    maxWidth: 140,
  },
  callText: { fontSize: 12, fontWeight: '800', color: colors.success },
  // Inside the open day's frame (TodayOrdersTab): a little in from its sides,
  // on the page's own shade so each row reads apart from the frame.
  doneRow: {
    marginHorizontal: 8,
    marginTop: 8,
    borderRadius: 12,
    backgroundColor: colors.paper,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  doneMark: {
    width: 20,
    height: 20,
    borderRadius: 99,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneMarkNum: { width: 26, height: 26, borderRadius: 13 },
  doneSeq: { fontSize: 13, fontWeight: '900', color: colors.onAccent },
  doneSeqOff: { color: colors.slate },
  doneMarkOff: { backgroundColor: colors.mist },
  doneNum: { fontSize: 12, fontWeight: '800', color: colors.slate },
  doneName: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.graphite },
  doneTime: { fontSize: 12, fontWeight: '700', color: colors.slate },
});
