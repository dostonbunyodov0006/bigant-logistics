import { useState } from 'react';
import { useOnShift } from '../hooks/useShift';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import type { OrderPickupSourcePublic, OrderPublic } from '@bigant/shared';
import { EtaTotal } from './EtaLine';
import { PhoneCallButton } from './OrderCallActions';
import { ProblemSheet } from './ProblemSheet';
import { useOrderJourney } from '../hooks/useOrderJourney';
import { useToast } from './Toast';
import { Icon } from './Icon';
import { colors } from './theme';
import type { RootStackParams } from '../navigation/RootNavigator';
import { clientTarget, openRoute, returnTarget, type RouteTarget } from '../lib/navigation';

type Nav = NativeStackNavigationProp<RootStackParams>;

/**
 * Everything above the action bar: who the order is for, how far through it the
 * driver is, and — large and bordered — the one place they are driving to now.
 *
 * The cargo grid, the stop list and its photos are gone from here; they moved
 * behind one collapsed row and the Batafsil screen. They are reference, and
 * reference was pushing the next step below the fold.
 */
export function ActiveOrderCard({ order, inTrip = false }: { order: OrderPublic; inTrip?: boolean }) {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const na = order.next_action;
  const j = useOrderJourney(order);
  const { showSuccess } = useToast();
  const [problemOpen, setProblemOpen] = useState(false);
  const shift = { onShift: useOnShift() };

  // An order he said "not today" to yesterday says so, with his reason, so
  // the morning starts where the evening left off.
  const leftOver = order.carried_over;
  const strip = (right: React.ReactNode) => (
    <>
      <View style={s.strip}>
        <View style={s.number}>
          <Text style={s.numberText}>{t('home.clientLabel')}</Text>
        </View>
        <Text style={s.client} numberOfLines={1}>
          {order.client_name}
        </Text>
        {right}
      </View>
      {leftOver ? (
        <View style={s.leftOver}>
          <Text style={s.leftOverChip}>{t('shift.leftOver')}</Text>
          <Text style={s.leftOverWhy} numberOfLines={2}>
            {t('shift.leftOverWhy', { why: [t(`shift.reasons.${leftOver.reason}`), leftOver.comment].filter(Boolean).join(' — ') })}
          </Text>
        </View>
      ) : null}
    </>
  );

  // --- A new assignment: the decision screen. Everything here exists to answer
  // "can I take this", including what it costs in time and distance. ---
  if (order.status === 'assigned_to_driver') {
    return (
      <View style={s.wrap}>
        <View style={s.banner}>
          <Text style={s.bannerText}>{t(order.kind === 'vozvrat' ? 'home.vozvratOrderNew' : 'home.newOrder')}</Text>
        </View>

        <View style={s.block}>
          {strip(null)}
          <Text style={s.bigName}>{order.client_name}</Text>
          <AddressLink text={clientAddress(order)} target={clientTarget(order)} />
          {order.created_by_seller_name ? (
            <Text style={s.seller}>
              {t('orders.bookedBySeller')}: {order.created_by_seller_name}
            </Text>
          ) : null}
          <View style={s.grid}>
            <Field label={t('home.cargoType')} value={order.cargo_type_name ?? '—'} />
            <Field
              label={t('home.weight')}
              value={order.weight_kg != null ? `${order.weight_kg} kg` : '—'}
            />
            <Field label={t('home.waybill')} value={order.waybill_source ?? '—'} />
          </View>
          {order.comment ? (
            <Text style={s.seller}>
              {t('orderDetail.comment')}: {order.comment}
            </Text>
          ) : null}
        </View>

        <View style={s.block}>
          <Text style={s.eyebrowMuted}>{t('trip.title')}</Text>
          {/* A return runs the other way — to the client first, and the goods
              come back from there — so listing the warehouse first told him to
              drive to the wrong end of town. */}
          {previewStops(order).map((stop) => (
            <View key={stop.key} style={s.previewRow}>
              <View style={s.previewDot} />
              <Text style={s.previewName} numberOfLines={1}>
                {stop.label}
              </Text>
            </View>
          ))}
          <View style={s.totalRow}>
            <EtaTotal order={order} />
          </View>
        </View>
      </View>
    );
  }

  // --- Carrying a return. Its own card in Hozirgi now: it is the driver's
  // actual job, not a footnote behind a banner in the header. ---
  if (order.status === 'returning') {
    const stop = order.pickup_sources.find((src) => src.id === na.pickup_id) ?? null;
    const outstanding = order.pickup_sources.filter((src) => src.return_required);
    const doneCount = outstanding.filter((src) => src.returned_at != null).length;
    return (
      <View style={s.wrap}>
        {strip(
          <View style={[s.pill, s.pillReturn]}>
            <Text style={[s.pillText, s.pillReturnText]}>
              {doneCount + 1} / {outstanding.length}
            </Text>
          </View>,
        )}

        {stop ? (
          <View style={s.current}>
            <View style={s.currentHead}>
              <Text style={s.eyebrow}>{t('home.returnDestTitle')}</Text>
              {stop.return_destination ? (
                <View style={s.tag}>
                  <Text style={s.tagText}>{t(`home.dest_${stop.return_destination}`)}</Text>
                </View>
              ) : null}
            </View>
            {/* The place the goods go back to, not the one they came from. */}
            {/* With the place's phone, a call at the name's right end, as for a
                pickup (owner, 12.11.2026). */}
            <View style={s.nameRow}>
              <Text style={[s.bigName, { flex: 1 }]}>{stop.return_place?.name ?? stop.name}</Text>
              {stop.return_place?.phone_number?.replace(/[^\d+]/g, '') ? (
                <Pressable
                  onPress={() => void Linking.openURL(`tel:${stop.return_place!.phone_number!.replace(/[^\d+]/g, '')}`)}
                  accessibilityRole="button"
                  accessibilityLabel={t('orders.callReturnPlace', { name: stop.return_place.name })}
                  hitSlop={8}
                  style={({ pressed }) => [s.callRound, pressed && { opacity: 0.7 }]}
                >
                  <Icon name="phone" size={18} color={colors.onAccent} strokeWidth={2.2} />
                </Pressable>
              ) : null}
            </View>
            <AddressLink text={stop.return_place?.address ?? stopAddress(stop)} target={returnTarget(stop)} />
            <View style={s.divider} />
            <Text style={s.rowLabel}>{t('home.whatReturns')}</Text>
            <Text style={s.rowValue}>
              {[order.cargo_type_name, order.weight_kg != null ? `${order.weight_kg} kg` : null]
                .filter(Boolean)
                .join(' · ') || '—'}
            </Text>
            {order.return_reason ? (
              <Text style={s.reason}>
                {t('home.reasonLabel')}: {order.return_reason}
              </Text>
            ) : null}
          </View>
        ) : null}

      </View>
    );
  }

  // --- The ordinary journey: four lines and three buttons. Where he is going
  // and what to do next are the action bar's; the card only has to say whose
  // order it is, where the goods are taken from, what they are, and whose
  // paper covers them — and give him the phone and the exception. ---
  const pickups = [...order.pickup_sources].sort((a, b) => a.position - b.position);
  const pickupText =
    pickups.length === 0
      ? '—'
      : pickups.map((src) => src.name).join(' → ');
  const cargoText =
    [order.cargo_type_name, order.weight_kg != null ? `${order.weight_kg} kg` : null].filter(Boolean).join(' · ') ||
    '—';

  return (
    <View style={s.wrap}>
      {leftOver ? (
        <View style={s.leftOverCard}>
          <Text style={s.leftOverChip}>{t('shift.leftOver')}</Text>
          <Text style={s.leftOverWhy} numberOfLines={2}>
            {t('shift.leftOverWhy', { why: [t(`shift.reasons.${leftOver.reason}`), leftOver.comment].filter(Boolean).join(' — ') })}
          </Text>
        </View>
      ) : null}

      <View style={s.sheet}>
        {/* On a po puti trip the Marshrut above already lists the clients and
            the pickups; the card keeps only cargo, waybill and note (owner, 10.11.2026). */}
        {inTrip ? null : (
          <>
            <InfoRow label={t('home.clientLabel')} value={order.client_name} strong />
            <InfoRow label={t('home.pickupLabel')} value={pickupText} />
          </>
        )}
        {/* Smaller on a po puti trip, so the Marshrut, these lines and the call
            buttons fit on one screen (owner, 10.11.2026). */}
        <InfoRow label={t('home.cargoTypeLabel')} value={cargoText} compact={inTrip} />
        <InfoRow label={t('home.waybill')} value={order.waybill_source ?? '—'} last={!order.comment} compact={inTrip} />
        {/* The seller's note, here too and not only in the order's detail (owner, 07.11.2026). */}
        {order.comment ? <InfoRow label={t('orderDetail.comment')} value={order.comment} last compact={inTrip} /> : null}
      </View>

      <View style={s.actions}>
        <View style={s.actionSlot}>
          <PhoneCallButton phone={order.created_by_seller_phone_number} label={t('orders.callSellerShort')} />
        </View>
        <View style={s.actionSlot}>
          <PhoneCallButton phone={order.client_phone_number} label={t('orders.callClientShort')} />
        </View>
        {shift.onShift ? (
        <View style={s.actionSlot}>
          <Pressable
            onPress={() => setProblemOpen(true)}
            accessibilityRole="button"
            style={({ pressed }) => [s.exception, pressed && s.exceptionPressed]}
          >
            <Icon name="warning" size={15} color={colors.warnInk} strokeWidth={2.2} />
            <Text style={s.exceptionText} numberOfLines={1}>
              {t('home.exception')}
            </Text>
          </Pressable>
        </View>
        ) : null}
      </View>

      {/* Vozrat moved to the bar below, beside "Yo'l ko'rsatish", always in sight (owner, 12.11.2026). */}

      <ProblemSheet
        visible={problemOpen}
        onClose={() => setProblemOpen(false)}
        orderNumber={order.order_number}
        clientName={order.client_name}
        pending={j.pending}
        alreadyReported={order.problem_reason != null}
        exceptionOnly
        onSubmitException={(reason, comment) =>
          j.exceptionM.mutate(
            { reason, comment },
            {
              onSuccess: () => {
                setProblemOpen(false);
                showSuccess(t('common.sentSuccessfully'));
              },
            },
          )
        }
        onChooseReturn={() => {
          setProblemOpen(false);
          nav.navigate('Vozvrat', { orderId: order.id });
        }}
      />
    </View>
  );
}

/** One line of the card: a label on the left, the value on the right. */
function InfoRow({
  label,
  value,
  strong,
  last,
  compact,
}: {
  label: string;
  value: string;
  strong?: boolean;
  last?: boolean;
  compact?: boolean;
}) {
  return (
    <View style={[s.infoRow, last && s.infoRowLast]}>
      <Text style={[s.infoLabel, compact && s.infoLabelCompact]}>{label}</Text>
      {/* A rule between the name of the line and its value, on every line. */}
      <View style={s.infoSep} />
      <Text style={[s.infoValue, strong && s.infoValueStrong, compact && s.infoValueCompact]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <Text style={s.fieldValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/** The address line; a tap on it opens the navigator when the place is pinned. */
function AddressLink({ text, target }: { text: string; target: RouteTarget | null }) {
  const { t } = useTranslation();
  if (!target) return <Text style={s.address}>{text || '—'}</Text>;
  return (
    <Pressable
      onPress={() => void openRoute(target)}
      accessibilityRole="link"
      accessibilityLabel={t('home.navigate')}
      hitSlop={6}
      style={s.addressLink}
    >
      <Icon name="navigation" size={14} color={colors.brandDark} strokeWidth={2.4} />
      <Text style={[s.address, s.addressLinkText]}>{text || t('home.navigate')}</Text>
    </Pressable>
  );
}

/** The stops in the order he will drive them. */
function previewStops(order: OrderPublic): { key: string; label: string }[] {
  const sources = [...order.pickup_sources]
    .sort((a, b) => a.position - b.position)
    .map((src) => ({
      key: src.id,
      label: src.district_name ? `${src.name} · ${src.district_name}` : src.name,
    }));
  const client = { key: `${order.id}:client`, label: order.client_name };
  return order.kind === 'vozvrat' ? [client, ...sources] : [...sources, client];
}

function clientAddress(order: OrderPublic): string {
  return [order.client_address, order.district_name, order.region_name].filter(Boolean).join(', ');
}

function stopAddress(stop: OrderPickupSourcePublic): string {
  return [stop.district_name, stop.region_name].filter(Boolean).join(', ');
}

const s = StyleSheet.create({
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  callRound: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' },
  wrap: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  banner: {
    borderRadius: 12,
    backgroundColor: colors.brandTint,
    borderWidth: 1,
    borderColor: colors.brand,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  bannerText: { fontSize: 13, fontWeight: '800', letterSpacing: 0.3, color: colors.brandDark },
  bannerReturn: { backgroundColor: colors.warnBg, borderColor: colors.warnBorder },
  bannerReturnText: { color: colors.warnInk },
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.white,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  number: { borderRadius: 8, backgroundColor: colors.chip, paddingHorizontal: 8, paddingVertical: 4 },
  numberText: { fontSize: 13, fontWeight: '800', color: colors.graphite },
  client: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.ink },
  leftOver: {
    marginHorizontal: 16,
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.warnBg,
    borderWidth: 1,
    borderColor: colors.warnBorder,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  leftOverChip: { fontSize: 12, fontWeight: '800', color: colors.warnInk },
  leftOverWhy: { flex: 1, fontSize: 12.5, color: colors.warnSoft },
  pill: { borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { fontSize: 11, fontWeight: '800' },
  pillGoing: { backgroundColor: colors.brandTint },
  pillGoingText: { color: colors.brandDark },
  pillFinal: { backgroundColor: colors.successBg },
  pillFinalText: { color: colors.success },
  pillReturn: { backgroundColor: colors.warnBg },
  pillReturnText: { color: colors.warn },
  block: { backgroundColor: colors.white, borderRadius: 14, padding: 16 },
  // The one card with a border: it is where the driver is going, and it should
  // be findable without reading.
  current: {
    backgroundColor: colors.white,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.brand,
    padding: 16,
  },
  currentHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eyebrow: {
    flex: 1,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: colors.brandDark,
  },
  eyebrowMuted: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.7,
    color: colors.slate,
  },
  tag: { borderRadius: 99, backgroundColor: colors.chip, paddingHorizontal: 9, paddingVertical: 3 },
  tagText: { fontSize: 10, fontWeight: '800', color: colors.graphite },
  bigName: { marginTop: 5, fontSize: 23, fontWeight: '800', color: colors.ink, lineHeight: 27 },
  address: { marginTop: 6, fontSize: 14, fontWeight: '600', color: colors.graphite, lineHeight: 19 },
  addressLink: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 6 },
  addressLinkText: { marginTop: 0, flex: 1, color: colors.brandDark, textDecorationLine: 'underline' },
  seller: { marginTop: 7, fontSize: 13, fontWeight: '700', color: colors.brandDark },
  calls: { marginTop: 2, flexDirection: 'row', gap: 8 },
  divider: { marginTop: 12, marginBottom: 11, height: 1, backgroundColor: colors.mist },
  reason: { marginTop: 4, fontSize: 13, fontWeight: '600', color: colors.slate, lineHeight: 18 },
  grid: { marginTop: 14, flexDirection: 'row', gap: 8 },
  field: { flex: 1, backgroundColor: colors.paper, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9 },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
    color: colors.slate,
  },
  fieldValue: { marginTop: 3, fontSize: 13, fontWeight: '700', color: colors.ink },
  previewRow: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 9 },
  previewDot: {
    width: 18,
    height: 18,
    borderRadius: 99,
    borderWidth: 2,
    borderColor: colors.mist,
  },
  previewName: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.ink },
  totalRow: { marginTop: 12, borderTopWidth: 1, borderTopColor: colors.mist, paddingTop: 10 },
  // A table: a frame round it, a rule under each line, and one rule down the
  // middle from top to bottom between the names and the values.
  sheet: {
    backgroundColor: colors.white,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.slate,
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderBottomWidth: 1.5,
    borderBottomColor: colors.slate,
  },
  infoRowLast: { borderBottomWidth: 0 },
  infoSep: { width: 1.5, backgroundColor: colors.slate },
  // Read at arm's length in a cab: big and bold.
  infoLabel: {
    width: 120,
    paddingHorizontal: 14,
    paddingVertical: 15,
    fontSize: 15,
    fontWeight: '800',
    color: colors.ink,
    textAlignVertical: 'center',
  },
  infoValue: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 18,
    fontWeight: '800',
    color: colors.ink,
    textAlign: 'right',
    textAlignVertical: 'center',
    lineHeight: 24,
  },
  infoValueStrong: { fontSize: 21, fontWeight: '900' },
  infoLabelCompact: { paddingVertical: 8, fontSize: 13, width: 104 },
  infoValueCompact: { paddingVertical: 7, fontSize: 14, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 8 },
  actionSlot: { flex: 1 },
  exception: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.warnBorder,
    backgroundColor: colors.warnBg,
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
  exceptionPressed: { opacity: 0.7 },
  vozvrat: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerBg,
    paddingVertical: 12,
  },
  vozvratText: { fontSize: 15, fontWeight: '800', color: colors.dangerInk },
  exceptionText: { fontSize: 14, fontWeight: '700', color: colors.warnInk },
  leftOverCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.warnBg,
    borderWidth: 1,
    borderColor: colors.warnBorder,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  rowLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    color: colors.slate,
  },
  rowValue: { marginTop: 2, fontSize: 14, fontWeight: '700', color: colors.ink },
});
