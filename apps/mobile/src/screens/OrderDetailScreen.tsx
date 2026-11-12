import { useEffect, useRef, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRoute, useNavigation, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { INCIDENT_TYPES, type IncidentType, type OrderPublic } from '@bigant/shared';
import { api } from '../lib/api';
import { formatDate, startSlotKey } from '../lib/format';
import { Card, DetailRow, EmptyState, SectionHeader, Spinner, StatusBadge } from '../components/ui';
import { PickupStops } from '../components/PickupStops';
import { OrderActionBar } from '../components/OrderActionBar';
import { ScreenHeader } from '../components/ScreenHeader';
import { colors } from '../components/theme';
import { useToast } from '../components/Toast';
import { PhoneCallButton } from '../components/OrderCallActions';
import { useCurrentOrder } from './tabs/CurrentOrdersTab';
import type { RootStackParams } from '../navigation/RootNavigator';

type Route = RouteProp<RootStackParams, 'OrderDetail'>;
type Nav = NativeStackNavigationProp<RootStackParams>;

const IN_PROGRESS = [
  'driver_accepted',
  'collecting_items',
  'items_collected',
  'on_the_way',
  'arrived_at_customer',
];

export function OrderDetailScreen() {
  const { id, takeReturn } = useRoute<Route>().params;
  const nav = useNavigation<Nav>();
  const { t } = useTranslation();
  const { showSuccess, showWarning } = useToast();
  const previousStatus = useRef<OrderPublic['status'] | null>(null);

  const orderQ = useQuery({
    queryKey: ['order', id],
    queryFn: () => api.get<OrderPublic>(`/orders/${id}`),
    refetchInterval: 15_000,
  });
  const order = orderQ.data;
  // Another order is under way: this one can be opened and read, but its
  // client and seller are not called until that one is done.
  const current = useCurrentOrder();
  const callsLocked = !!current && !!order && current.id !== order.id;


  useEffect(() => {
    if (!order) return;
    const before = previousStatus.current;
    previousStatus.current = order.status;
    if (before && before !== 'cancelled' && order.status === 'cancelled') {
      const cancelled = t('notificationType.order.cancelled.body', {
        client: order.client_name,
      });
      const reason = order.cancellation_reason
        ? `\n${t('orderDetail.cancellationReason')}: ${order.cancellation_reason}`
        : '';
      showWarning(cancelled + reason);
      if (nav.canGoBack()) nav.goBack();
      else nav.navigate('DriverHome');
    }
  }, [nav, order, showWarning, t]);
  const [incidentType, setIncidentType] = useState<IncidentType | ''>('');
  const [incidentDesc, setIncidentDesc] = useState('');
  const incidentM = useMutation({
    mutationFn: () =>
      api.post('/drivers/me/incidents', {
        type: incidentType,
        description: incidentDesc || undefined,
        order_id: id,
      }),
    onSuccess: () => {
      setIncidentType('');
      setIncidentDesc('');
      showSuccess(t('common.sentSuccessfully'));
    },
    onError: () => Alert.alert(t('errors.generic')),
  });

  if (orderQ.isLoading) {
    return (
      <View style={s.screen}>
        <ScreenHeader title="" />
        <Spinner />
      </View>
    );
  }
  if (!order) {
    return (
      <View style={s.screen}>
        <ScreenHeader title="" />
        <EmptyState title={t('orderDetail.notFound')} />
      </View>
    );
  }

  return (
    <View style={s.screen}>
    <ScreenHeader title={t('orderDetail.title', { number: order.order_number })} />
    <ScrollView style={s.scroll} contentContainerStyle={s.content}>
      <View style={s.statusRow}>
        <StatusBadge status={order.status} />
        {order.priority === 'urgent' && (
          <View style={s.urgentBadge}>
            <Text style={s.urgentText}>{t('priority.urgent')}</Text>
          </View>
        )}
      </View>

      <Card style={s.section}>
        {/* "Mijoz - Aziz" on one line, not the name under its label. */}
        <View style={s.nameRow}>
          <SectionHeader title={t('orderDetail.client')} />
          <Text style={s.nameDash}>-</Text>
          <Text style={s.clientName} numberOfLines={1}>{order.client_name}</Text>
        </View>
        {callsLocked ? null : <DetailRow label={t('orderDetail.phone')} value={order.client_phone_number} mono />}
        <DetailRow
          label={t('orderDetail.address')}
          value={
            [order.client_address, order.district_name, order.region_name].filter(Boolean).join(', ') ||
            '—'
          }
        />
        <DetailRow
          label={t('orderDetail.delivery')}
          value={
            startSlotKey(order)
              ? `${formatDate(order.delivery_datetime)} · ${t(startSlotKey(order)!)}`
              : formatDate(order.delivery_datetime)
          }
        />
        {/* Whose paper covers the load: the seller chose it when booking. */}
        <DetailRow label={t('home.waybill')} value={order.waybill_source ?? '—'} />
        {order.comment ? <DetailRow label={t('orderDetail.comment')} value={order.comment} /> : null}
        {order.cancellation_reason ? (
          <DetailRow label={t('orderDetail.cancellationReason')} value={order.cancellation_reason} />
        ) : null}
        <PhoneCallButton phone={order.client_phone_number} label={t('orders.callClient')} disabled={callsLocked} />
      </Card>

      {(order.created_by_seller_name || order.created_by_seller_phone_number) && (
        <Card style={s.section}>
          <View style={s.nameRow}>
            <SectionHeader title={t('orderDetail.seller')} />
            <Text style={s.nameDash}>-</Text>
            <Text style={s.clientName} numberOfLines={1}>{order.created_by_seller_name ?? '—'}</Text>
          </View>
          {order.created_by_seller_phone_number && !callsLocked ? (
            <DetailRow
              label={t('orderDetail.phone')}
              value={order.created_by_seller_phone_number}
              mono
            />
          ) : null}
          <PhoneCallButton
            phone={order.created_by_seller_phone_number}
            label={t('orders.callSeller')}
            disabled={callsLocked}
          />
        </Card>
      )}

      {order.pickup_sources.length > 0 && (
        <Card style={s.section}>
          <PickupStops sources={order.pickup_sources} />
        </Card>
      )}

      <Card style={s.section}>
        <SectionHeader title={t('orderDetail.products')} />
        {order.items.map((it) => (
          <View key={it.id} style={s.itemRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.itemName}>
                {it.product_name} <Text style={s.itemQty}>{'×'}{it.quantity}</Text>
              </Text>
            </View>
          </View>
        ))}
      </Card>

      {/* Proof of delivery */}
      {order.status === 'delivered' && order.proof_photo_url ? (
        <Card style={s.section}>
          <SectionHeader title={t('orderDetail.proofOfDelivery')} />
          <Image source={{ uri: order.proof_photo_url }} style={s.proofPhoto} resizeMode="cover" />
        </Card>
      ) : null}

      {/* Vozrat hand-back proof */}
      {order.status === 'returned' && order.return_proof_photo_url ? (
        <Card style={s.section}>
          <SectionHeader title={t('orderDetail.returnProof')} />
          <Image source={{ uri: order.return_proof_photo_url }} style={s.proofPhoto} resizeMode="cover" />
        </Card>
      ) : null}

      {/* Report incident (during an active delivery) */}
      {IN_PROGRESS.includes(order.status) && (
        <Card style={s.section}>
          <Text style={s.incidentTitle}>{t('incident.report')}</Text>
          <View style={s.incidentChips}>
            {INCIDENT_TYPES.map((it) => (
              <Pressable
                key={it}
                // A second tap takes the pick back (owner, 07.11.2026: a finger slipped).
                onPress={() => setIncidentType((cur) => (cur === it ? '' : it))}
                style={[s.incidentChip, incidentType === it && s.incidentChipActive]}
              >
                <Text style={[s.incidentChipText, incidentType === it && s.incidentChipTextActive]}>
                  {t(`incidentType.${it}`)}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={s.incidentInput}
            value={incidentDesc}
            onChangeText={setIncidentDesc}
            placeholder={t('incident.descPlaceholder')}
            placeholderTextColor={colors.slateLt}
            multiline
          />
          <Pressable
            onPress={() => {
              if (!incidentType) {
                Alert.alert(t('common.completeRequiredFields'));
                return;
              }
              incidentM.mutate();
            }}
            disabled={incidentM.isPending}
            style={[s.btnFull, s.btnDanger, incidentM.isPending && { opacity: 0.6 }]}
          >
            <Text style={s.btnFullText}>{t('incident.submit')}</Text>
          </Pressable>
        </Card>
      )}
    </ScrollView>
    {/* Same bar as Hozirgi: one action, always at the thumb. */}
    <OrderActionBar order={order} takeReturn={takeReturn} />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  scroll: { flex: 1, backgroundColor: colors.paper },
  content: { padding: 16, paddingBottom: 40 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  urgentBadge: { borderRadius: 99, backgroundColor: colors.brandTint, paddingHorizontal: 8, paddingVertical: 3 },
  urgentText: { fontSize: 11, fontWeight: '700', color: colors.brandDark },
  section: { marginBottom: 12, padding: 16 },
  clientName: { flexShrink: 1, fontSize: 16, fontWeight: '700', color: colors.ink },
  nameRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 6 },
  nameDash: { fontSize: 16, fontWeight: '700', color: colors.slate },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.mist + '60',
    paddingVertical: 8,
  },
  itemName: { fontSize: 14, fontWeight: '500', color: colors.ink },
  itemQty: { fontFamily: 'monospace', color: colors.slate },
  itemStatus: { fontSize: 12, color: colors.slate },
  actions: { marginBottom: 12 },
  proofPhoto: { width: '100%', height: 240, borderRadius: 12, backgroundColor: colors.mist },
  // Two to a row: Avariya · Nosozlik, then Shikast · Boshqa — the driver taps, he does not read.
  incidentChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  incidentTitle: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.4,
    color: colors.danger,
    marginBottom: 8,
  },
  incidentChip: {
    borderRadius: 99,
    borderWidth: 1,
    borderColor: colors.mist,
    paddingHorizontal: 12,
    paddingVertical: 6,
    width: '48%',
    alignItems: 'center',
  },
  incidentChipActive: { borderColor: colors.danger, backgroundColor: colors.dangerBg },
  incidentChipText: { fontSize: 13, fontWeight: '500', color: colors.slate },
  incidentChipTextActive: { color: colors.danger, fontWeight: '700' },
  incidentInput: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.mist,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.ink,
    marginBottom: 12,
  },
  btnFull: {
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: colors.brand,
    paddingVertical: 16,
    marginBottom: 12,
  },
  // Reporting an exception is not an ordinary step of the journey, and the
  // colour says so before the words do.
  btnDanger: { backgroundColor: colors.danger },
  btnFullText: { fontSize: 15, fontWeight: '700', color: colors.onAccent },
});
