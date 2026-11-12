import { useState } from 'react';
import { isOrderActionLocked } from '../hooks/useOrderActivationClock';
import { useOnShift } from '../hooks/useShift';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { useBottomInset } from '../lib/useBottomInset';
import type { OrderExceptionReason, OrderPublic, ReturnDestination } from '@bigant/shared';
import { useOrderJourney } from '../hooks/useOrderJourney';
import { nextTargetOf, openRoute } from '../lib/navigation';
import { EtaLine } from './EtaLine';
import { PhotoSheet } from './PhotoSheet';
import { errorText } from '../lib/errorText';
import { ProblemSheet } from './ProblemSheet';
import { ReturnDestinationSheet } from './ReturnDestinationSheet';
import { ErrorBanner } from './ui';
import { useToast } from './Toast';
import { Icon } from './Icon';
import { colors } from './theme';
import type { RootStackParams } from '../navigation/RootNavigator';
import { useCurrentOrder } from '../screens/tabs/CurrentOrdersTab';

type Nav = NativeStackNavigationProp<RootStackParams>;
type SheetKind = 'photo' | 'problem' | 'returns' | null;

/** What the driver is asked to do next, and how the button should look saying it. */
interface Action {
  label: string;
  tone: 'brand' | 'success';
  /** Confirming this step uploads a proof photo first. */
  proof?: { title: string; subtitle: string; run: (photoUrl: string, comment: string | null) => void };
  press?: () => void;
}

/**
 * The pinned bottom bar: how far, one large action, then the two quiet ones.
 *
 * It is the whole point of the redesign. The action used to live at the end of
 * a long card — under the cargo grid, the call buttons, the stop list and its
 * photos — so the driver scrolled to find out what to do next, every time. Here
 * it is in the same place on every screen and never scrolls away, and the card
 * above it only answers where they are and where they are going.
 *
 * It owns the sheets too, because each one is the second half of an action the
 * bar offers.
 */
export function OrderActionBar({ order, takeReturn = false }: { order: OrderPublic; takeReturn?: boolean }) {
  const { t } = useTranslation();
  // Android 15 draws the app under the system navigation bar; the bar's
  // bottom padding grows to clear it, and the white background runs beneath.
  const bottomInset = useBottomInset();
  const nav = useNavigation<Nav>();
  const { showSuccess, showWarning } = useToast();
  const j = useOrderJourney(order);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const shift = { onShift: useOnShift() };

  const na = order.next_action;
  // The order he is on right now; an accepted order that is not it waits.
  const current = useCurrentOrder();
  const close = () => setSheet(null);
  const done = () => {
    close();
    showSuccess(t('common.sentSuccessfully'));
  };

  // Which loads the return sheet asks about: while returning it is the ones
  // still owed back, at the client it is everything actually collected.
  const returnSources = order.pickup_sources.filter((source) =>
    order.status === 'returning' ? source.return_required : source.leg_status === 'arrived',
  );

  const submitReturn = (
    returns: { pickup_source_id: string; destination: ReturnDestination }[],
    reason: string | null,
  ) => j.startReturnM.mutate({ returns, reason }, { onSuccess: close });

  const submitException = (reason: OrderExceptionReason, comment: string | null) =>
    j.exceptionM.mutate({ reason, comment }, { onSuccess: done });

  // Off shift, or a booking not open yet: he may open the order and read it
  // all; nothing can be pressed.
  const notYet = isOrderActionLocked(order);
  if (!shift.onShift || notYet) {
    return (
      <View style={[s.bar, { paddingBottom: Math.max(bottomInset, 16) }]}>
        <View style={s.offShift}>
          <Icon name="lock" size={16} color={colors.slate} strokeWidth={2.2} />
          <Text style={s.offShiftText}>{notYet ? t('orders.notOpenYet') : t('shift.startToWork')}</Text>
        </View>
      </View>
    );
  }

  // --- A new assignment: one button. Rejecting is a phone call to the
  // dispatcher, not a tap, so the app no longer offers it. ---
  if (order.status === 'assigned_to_driver') {
    if (!j.pendingAssignment) {
      // The order is his, but the assignment list did not arrive. Say so and
      // give him the tap, rather than a screen with no way forward.
      if (j.assignmentsQ.isError) {
        return (
          <View style={[s.bar, { paddingBottom: Math.max(bottomInset, 16) }]}>
            <ErrorBanner message={errorText(j.assignmentsQ.error)} />
            <Pressable
              onPress={() => void j.assignmentsQ.refetch()}
              disabled={j.assignmentsQ.isFetching}
              accessibilityRole="button"
              style={[s.primary, j.assignmentsQ.isFetching && s.dim]}
            >
              <Text style={s.primaryText}>{t('common.retry')}</Text>
            </Pressable>
          </View>
        );
      }
      return null;
    }
    return (
      <View style={[s.bar, { paddingBottom: Math.max(bottomInset, 16) }]}>
        <Errors j={j} />
        <Pressable
          onPress={() => j.acceptM.mutate()}
          disabled={j.pending}
          accessibilityRole="button"
          style={[s.primary, s.success, j.pending && s.dim]}
        >
          <Text style={s.primaryText}>{t('orderDetail.accept')}</Text>
        </Pressable>
      </View>
    );
  }

  // --- One job at a time: the next order opens when the current one is
  // delivered. Until then its bar says so, and the server refuses the tap. ---
  if (order.status === 'driver_accepted' && current && current.id !== order.id) {
    return (
      <View style={[s.bar, { paddingBottom: Math.max(bottomInset, 16) }]}>
        <View style={s.waitBox}>
          <Text style={s.waitText}>{t('home.finishCurrentFirst')}</Text>
        </View>
      </View>
    );
  }

  // --- Co-load: the server withholds this order's action until its stop comes
  // round. Say why rather than showing an empty bar. ---
  if (na.type === 'waiting_for_trip_stop') {
    return (
      <View style={[s.bar, { paddingBottom: Math.max(bottomInset, 16) }]}>
        <View style={s.waitBox}>
          <Text style={s.waitText}>{t('home.waitingForTripStop')}</Text>
        </View>
      </View>
    );
  }

  // The write-up is with the seller. No button until he answers — the goods
  // are his, and a list he has not seen must not reach the warehouse.
  if (na.type === 'return_confirm_wait') {
    return (
      <View style={[s.bar, { paddingBottom: Math.max(bottomInset, 16) }]}>
        <View style={s.waitBox}>
          <Text style={s.waitText}>{t('home.returnConfirmWait')}</Text>
        </View>
      </View>
    );
  }

  // At the warehouse with goods the storekeeper has not taken in yet: he
  // accepts them in the vozvrat mini app, and only then can they be handed over.
  if (na.type === 'return_wait_warehouse') {
    return (
      <View style={[s.bar, { paddingBottom: Math.max(bottomInset, 16) }]}>
        <View style={s.waitBox}>
          <Text style={s.waitTitle}>{t('home.returnWarehouseWaitTitle')}</Text>
          <Text style={s.waitText}>{t('home.returnWarehouseWait')}</Text>
        </View>
      </View>
    );
  }

  // It came back, with his reason: write it again.
  if (na.type === 'return_rewrite') {
    return (
      <View style={[s.bar, { paddingBottom: Math.max(bottomInset, 16) }]}>
        <View style={s.waitBox}>
          <Text style={s.waitTitle}>{t('home.returnRewriteTitle')}</Text>
          <Text style={s.waitText}>{order.return_items_reject_reason ?? ''}</Text>
        </View>
        <Pressable
          onPress={() => nav.navigate('Vozvrat', { orderId: order.id })}
          accessibilityRole="button"
          style={[s.primary, s.brand]}
        >
          <Text style={s.primaryText}>{t('home.returnRewriteBtn')}</Text>
        </Pressable>
      </View>
    );
  }

  const place = na.pickup_name ?? '';
  // On the way back the place is where the goods go, not where they were
  // loaded (owner, 12.11.2026: "BIGANT sklad ga yo'l oldim" for a return bound
  // for BIGANT do'kon). The stop's return place names it; its own name otherwise.
  const returnStop = order.pickup_sources.find((src) => src.id === na.pickup_id);
  const returnPlace = returnStop?.return_place?.name ?? place;
  const action = ((): Action | null => {
    switch (na.type) {
      case 'depart_pickup':
        return {
          label: t('home.headingToPickup', { name: place }),
          tone: 'brand',
          press: () => j.departPickupM.mutate(na.pickup_id!),
        };
      case 'arrive_pickup':
        return {
          label: t('home.arrivedAtPickup', { name: place }),
          tone: 'brand',
          proof: {
            title: t('proof.pickupTitle'),
            subtitle: t('proof.pickupSubtitle', { name: place }),
            run: (photoUrl, comment) =>
              j.arrivePickupM.mutate({ pickupId: na.pickup_id!, photoUrl, comment }, { onSuccess: done }),
          },
        };
      case 'depart_customer':
        return {
          label: t('home.headingToCustomer'),
          tone: 'brand',
          press: () => j.departCustomerM.mutate(),
        };
      case 'arrive_customer':
        return {
          label: t('home.arrivedAtCustomer'),
          tone: 'success',
          press: () => j.arriveCustomerM.mutate(),
        };
      case 'deliver':
        return {
          label: t('home.cargoDelivered'),
          tone: 'success',
          proof: {
            title: t('proof.deliverTitle'),
            subtitle: t('home.clientNamed', { name: order.client_name }),
            run: (photoUrl, comment) => j.deliverM.mutate({ photoUrl, comment }, { onSuccess: done }),
          },
        };
      case 'collect_return':
        // A vozvrat order at the client: what comes back is written up on the
        // vozvrat screen, which starts the return legs itself.
        return {
          label: t('home.collectReturn'),
          tone: 'success',
          press: () => nav.navigate('Vozvrat', { orderId: order.id }),
        };
      case 'return_configure':
        return {
          label: t('home.configureReturns'),
          tone: 'brand',
          press: () => setSheet('returns'),
        };
      case 'return_depart':
        return {
          label: t('home.returnDepartBtn', { place: returnPlace }),
          tone: 'brand',
          press: () => j.departReturnM.mutate(na.pickup_id!),
        };
      case 'return_arrive':
        return {
          label: t('home.returnArriveBtn', { place: returnPlace }),
          tone: 'success',
          press: () => j.arriveReturnM.mutate(na.pickup_id!),
        };
      case 'return_complete':
        return {
          label: t('home.returnComplete'),
          tone: 'success',
          proof: {
            title: t('proof.returnTitle'),
            subtitle: t('proof.returnSubtitle', { name: place }),
            run: (photoUrl, comment) =>
              j.completeReturnM.mutate({ pickupId: na.pickup_id!, photoUrl, comment }, { onSuccess: done }),
          },
        };
      default:
        return null;
    }
  })();

  if (!action) return null;

  return (
    <View style={[s.bar, { paddingBottom: Math.max(bottomInset, 16) }]}>
      <Errors j={j} />
      <EtaLine order={order} />

      {/* The exception moved up onto the order card, beside the phone
          buttons; the way there is the one quiet button down here. */}
      <View style={s.row}>
        <Pressable
          onPress={() => {
            const target = nextTargetOf(order);
            if (!target) {
              showWarning(t('home.noCoordinates'));
              return;
            }
            void openRoute(target).then((opened) => {
              if (!opened) showWarning(t('home.noNavigator'));
            });
          }}
          accessibilityRole="button"
          style={s.secondary}
        >
          <Icon name="navigation" size={15} />
          <Text style={s.secondaryText}>{t('home.navigate')}</Text>
        </Pressable>
        {/* Vozrat beside it, always in sight (owner, 12.11.2026): on the card it
            sat under the bar's edge. On the way and at the door, as before. */}
        {(order.status === 'on_the_way' || order.status === 'arrived_at_customer') && order.kind !== 'vozvrat' ? (
          <Pressable
            onPress={() => nav.navigate('Vozvrat', { orderId: order.id })}
            accessibilityRole="button"
            style={[s.secondary, s.returnBtn]}
          >
            <Icon name="return" size={15} color={colors.dangerInk} strokeWidth={2.2} />
            <Text style={[s.secondaryText, { color: colors.dangerInk }]}>{t('home.returnCargo')}</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={s.row}>
        <Pressable
          onPress={action.proof ? () => setSheet('photo') : action.press}
          disabled={j.pending}
          accessibilityRole="button"
          style={[s.primary, { flex: 1 }, action.tone === 'success' ? s.success : s.brand, j.pending && s.dim]}
        >
          {/* The camera marks the steps that will ask for a photo, so the
              requirement is known before the tap, not after it. */}
          {action.proof ? <Icon name="camera" size={19} color={colors.onAccent} /> : null}
          {/* One line always: the text shrinks to fit beside Ojidaniya rather than wrap. */}
          <Text style={s.primaryText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
            {action.label}
          </Text>
        </Pressable>
        {/* Ojidaniya, beside the step itself: a small return waits in the back
            while the next order is done, under the yellow "qaytarilgan yuk" button. */}
        {/* Not when he opened it from "Vozvrat qilinadigan yuk bor": he came to take it back.
            Nor on a vozvrat the seller made: that is the job itself, he goes and brings it. */}
        {(na.type === 'return_depart' || na.type === 'return_arrive') && !order.return_deferred_at && !takeReturn && order.kind !== 'vozvrat' ? (
          <Pressable
            onPress={() =>
              j.deferReturnM.mutate(undefined, {
                onSuccess: () => {
                  showSuccess(t('home.returnDeferred'));
                  if (nav.canGoBack()) nav.goBack();
                },
              })
            }
            disabled={j.pending}
            accessibilityRole="button"
            style={[s.primary, s.defer, j.pending && s.dim]}
          >
            <Icon name="clock" size={16} color="#422006" />
            <Text style={s.deferText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
              {t('home.returnDefer')}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {action.proof && (
        <PhotoSheet
          visible={sheet === 'photo'}
          onClose={close}
          title={action.proof.title}
          subtitle={action.proof.subtitle}
          confirmLabel={t('proof.confirm')}
          commentPlaceholder={t('proof.commentPlaceholder')}
          pending={j.pending}
          onConfirm={action.proof.run}
        />
      )}

      <ProblemSheet
        visible={sheet === 'problem'}
        onClose={close}
        orderNumber={order.order_number}
        clientName={order.client_name}
        pending={j.pending}
        alreadyReported={order.problem_reason != null}
        onSubmitException={submitException}
        // At the client a vozvrat starts with the report of what came back.
        onChooseReturn={() => {
          close();
          nav.navigate('Vozvrat', { orderId: order.id });
        }}
      />

      <ReturnDestinationSheet
        visible={sheet === 'returns'}
        onClose={close}
        orderNumber={order.order_number}
        clientName={order.client_name}
        sources={returnSources}
        pending={j.pending}
        onSubmit={submitReturn}
      />
    </View>
  );
}

/** The first mutation error, if any — the bar has room for one line, and a
 *  driver only ever needs to know that the last tap did not land. */
function Errors({ j }: { j: ReturnType<typeof useOrderJourney> }) {
  const failed =
    j.acceptM.error ??
    j.departPickupM.error ??
    j.arrivePickupM.error ??
    j.departCustomerM.error ??
    j.arriveCustomerM.error ??
    j.deliverM.error ??
    j.exceptionM.error ??
    j.startReturnM.error ??
    j.departReturnM.error ??
    j.arriveReturnM.error ??
    j.completeReturnM.error;
  if (!failed) return null;
  return <ErrorBanner message={errorText(failed)} />;
}

const s = StyleSheet.create({
  offShift: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 6 },
  offShiftText: { fontSize: 14, fontWeight: '700', color: colors.slate },
  bar: {
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.mist,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 10,
  },
  dim: { opacity: 0.6 },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    height: 56,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  brand: { backgroundColor: colors.brand },
  success: { backgroundColor: colors.success },
  primaryText: { fontSize: 17, fontWeight: '800', color: colors.onAccent, flexShrink: 1 },
  row: { flexDirection: 'row', gap: 8 },
  secondary: {
    flex: 1,
    flexDirection: 'row',
    gap: 7,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.mist,
    backgroundColor: colors.white,
  },
  defer: { backgroundColor: '#facc15', paddingHorizontal: 12, gap: 6 },
  deferText: { fontSize: 15, fontWeight: '800', color: '#422006', flexShrink: 1 },
  secondaryText: { fontSize: 14, fontWeight: '700', color: colors.graphite },
  returnBtn: { borderColor: colors.danger, backgroundColor: colors.dangerBg },
  note: { textAlign: 'center', fontSize: 12, fontWeight: '600', color: colors.slate },
  waitBox: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.mist,
    backgroundColor: colors.paper,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  waitText: { fontSize: 14, fontWeight: '600', color: colors.slate, textAlign: 'center' },
  waitTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.ink,
    textAlign: 'center',
    marginBottom: 4,
  },
});
