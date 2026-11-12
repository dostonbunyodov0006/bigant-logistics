import { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery } from '@tanstack/react-query';
import { queryClient } from '../lib/queryClient';
import { useTranslation } from 'react-i18next';
import type { NotificationPublic, OrderPublic, WorkSettings } from '@bigant/shared';
import { useAuth } from '../auth/AuthContext';
import { useShiftContext } from './ShiftProvider';
import { api } from '../lib/api';
import i18n from '../i18n';
import { ORDERS_LIST_KEY, fetchOrders } from '../lib/ordersQuery';
import { SERVICE_KEYS, fetchMyDue } from '../lib/service';
import { Icon } from './Icon';
import { BreakSheet } from './BreakSheet';
import { SettingsSheet } from './SettingsSheet';
import { Sheet } from './Sheet';
import { colors } from './theme';
import { useKeyboardHeight } from '../lib/useKeyboardHeight';
import { breakState } from '../lib/breakState';
import type { RootStackParams } from '../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParams>;

/** Before the shift end the switch only offers a break. The end is the one the
 *  office set (Kunlik ish soati), and the time is Tashkent's, not the phone's. */
const FALLBACK_SHIFT_END = '18:00';
const tashkentMinutesNow = () => {
  const d = new Date(Date.now() + 5 * 3_600_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Persistent driver header (matches the prototype): the driver's own name over
 *  "model · plate", with the bell and Chiqish beside it, then the duty toggle and
 *  "Ish boshlandi · 08:12" underneath. The brand line is gone — the driver knows
 *  which app they opened, and the two rows it cost belong to the order card.
 *  Owns the shift toggle and the late/early accountability modal. */
export function DriverHeader() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const nav = useNavigation<Nav>();
  const shift = useShiftContext();
  const driver = shift.driver;
  const workQ = useQuery({
    queryKey: ['settings', 'work'],
    queryFn: () => api.get<WorkSettings>('/settings/work'),
    staleTime: 5 * 60_000,
  });
  const shiftEnd = workQ.data?.shift_end ?? FALLBACK_SHIFT_END;
  // Every label that names the shift start or end shows the office's times.
  useEffect(() => {
    const d = workQ.data;
    if (!d) return;
    const trim = (hhmm: string) => hhmm.replace(/^0(\d):/, '$1:');
    const opts = i18n.options.interpolation ?? (i18n.options.interpolation = {});
    opts.defaultVariables = { ...(opts.defaultVariables ?? {}), start: trim(d.shift_start), end: trim(d.shift_end) };
    void i18n.changeLanguage(i18n.language);
  }, [workQ.data]);

  // Unread badge on the bell (shares the notifications list cache).
  const notifQ = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => api.get<NotificationPublic[]>('/notifications'),
    refetchInterval: 30_000,
  });
  const unread = (notifQ.data ?? []).filter((n) => !n.read_at).length;

  // A dot on the wrench while a work is within range or overdue — the same
  // signal the home strip gives, visible from every tab.
  const dueQ = useQuery({ queryKey: SERVICE_KEYS.due, queryFn: fetchMyDue, refetchInterval: 60_000 });
  const serviceDue = (dueQ.data ?? []).some((d) => d.remaining_km != null);

  // A carried Vozrat rides along while the driver takes other work, and blocks
  // clock-out until it is handed back — so the reminder has to outlive the tab
  // the driver happens to be on. It shares the cached order list the tabs use.
  const returnsQ = useQuery({
    queryKey: ORDERS_LIST_KEY,
    queryFn: fetchOrders,
    select: (all: OrderPublic[]) => all.filter((o) => o.status === 'returning'),
    refetchInterval: 15_000,
  });
  const pendingReturns = returnsQ.data ?? [];
  // With two or more aboard, a tap lists them, and each opens on its own.
  const [returnsOpen, setReturnsOpen] = useState(false);
  const placeOf = (o: OrderPublic) => o.pickup_sources.find((src) => src.return_required)?.name ?? '';

  // On a break the switch goes dark: not off (the day is not over), not green
  // (he is not working). Turning it back on ends the break there and then
  // (owner, 12.11.2026) — no trip to Ma'lumotlar — and the GPS, internet and
  // battery saver checks apply at once.
  const brk = breakState(driver);
  const onBreak = brk === 'running' || brk === 'lapsed';
  // Fuel and service are refused only while the break runs, as the server does.
  const breakRunning = brk === 'running';
  const endBreakM = useMutation({
    mutationFn: () => api.del('/drivers/me/break'),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['driver', 'me'] }),
    onError: () => Alert.alert(t('errors.generic')),
  });

  // Three short lines (owner, 07.11.2026): his first name only — names are
  // kept "Familiya Ism", so the second word —, the lorry's name without its
  // body length ("5.80 metr"), and the plate on a line of its own.
  const fullName = user?.name ?? driver?.name ?? '';
  const words = fullName.trim().split(/\s+/);
  const firstName = words.length > 1 ? words[1] : fullName;
  const model = driver?.vehicle_model?.replace(/\s*\d+(?:[.,]\d+)?\s*metr\s*$/i, '').trim();
  const plate = driver?.vehicle_plate ?? null;

  const [settingsOpen, setSettingsOpen] = useState(false);
  const keyboard = useKeyboardHeight();
  // Turning the switch off asks what he means by it, rather than ending his
  // day on the strength of one tap.
  const [breakOpen, setBreakOpen] = useState(false);

  return (
    <View style={s.header}>
      <BreakSheet
        visible={breakOpen}
        onClose={() => setBreakOpen(false)}
        onDayOff={(reason, then) => shift.dayOff(reason, then)}
        dayOffPending={shift.pending}
      />
      <SettingsSheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        unread={unread}
        onNotifications={() => nav.navigate('Notifications')}
        // Ending the working day is a decision, not a reflex: it is made here
        // rather than on the switch a sleeve can brush.
        pending={shift.pending}
      />
      <View style={s.topRow}>
        <View style={s.identity}>
          <Text style={s.name} numberOfLines={1}>
            {firstName}
          </Text>
          {model ? (
            <Text style={s.vehicle} numberOfLines={1}>
              {model}
            </Text>
          ) : null}
          {plate ? (
            <Text style={s.vehicle} numberOfLines={1}>
              {plate}
            </Text>
          ) : null}
        </View>
        {/* The shift switch sits in the row with the tools, first of the four. */}
        <Switch
          style={s.switch}
          value={shift.onShift && !onBreak}
          // Off is the one way to end the day. It asks once, and a break is
          // offered in the same breath for the driver who only meant an hour.
          // Before 18:00 the day cannot be ended from here at all — the switch
          // only offers the break; the working day closes after six.
          onValueChange={() => {
            if (onBreak) {
              endBreakM.mutate();
              return;
            }
            if (!shift.onShift) {
              shift.handleToggle();
              return;
            }
            if (tashkentMinutesNow() < minutesOf(shiftEnd)) {
              // Before the end of the day the switch means a break, and the
              // break form opens straight on its first question.
              setBreakOpen(true);
              return;
            }
            Alert.alert(t('shift.endShift'), t('shift.endShiftConfirm'), [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('shift.breakInstead'), onPress: () => setBreakOpen(true) },
              { text: t('shift.endShift'), style: 'destructive', onPress: () => shift.handleToggle() },
            ]);
          }}
          disabled={shift.pending || endBreakM.isPending}
          // Literal colours: the theme's "white" is near-black on the dark
          // set, and the thumb vanished into the track.
          trackColor={{ true: '#22c55e', false: '#6b7280' }}
          thumbColor="#ffffff"
          ios_backgroundColor="#6b7280"
        />
        {/* Service and fuel sit with the bell: always reachable, order or no
            order, and the same bordered square so the three read as one row. */}
        <Pressable
          style={s.bell}
          // Not on a break (owner, 12.11.2026): no position is taken then, and a
          // visit is checked by it. He ends the break with the switch first.
          onPress={() => (breakRunning ? Alert.alert(t('errors.driver_on_break')) : nav.navigate('ServiceReasons'))}
          accessibilityRole="button"
          accessibilityLabel={t('service.open')}
          hitSlop={6}
        >
          <Icon name="wrench" size={17} />
          {serviceDue && <View style={s.bellDot} />}
        </Pressable>
        <Pressable
          style={s.bell}
          onPress={() => (breakRunning ? Alert.alert(t('errors.driver_on_break')) : nav.navigate('FuelType'))}
          accessibilityRole="button"
          accessibilityLabel={t('fuel.open')}
          hitSlop={6}
        >
          <Icon name="fuel" size={18} />
        </Pressable>
        {/* Everything that is not the job — how it looks, what it tells him,
            the way out — behind one gear, so a thumb reaching for the fuel log
            cannot sign him out. */}
        <Pressable
          style={s.bell}
          onPress={() => setSettingsOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={t('settings.title')}
          hitSlop={6}
        >
          <Icon name="settings" size={18} />
          {unread > 0 && <View style={s.bellDot} />}
        </Pressable>
      </View>


      {/* One tap to the return itself, wherever the driver is. It opens the
          order, whose pinned bar carries the same steps as Hozirgi — the old
          banner opened a modal with its own copy of them. */}
      {pendingReturns.length > 0 && (
        <Pressable
          style={s.returns}
          onPress={() =>
            pendingReturns.length === 1
              ? nav.navigate('OrderDetail', { id: pendingReturns[0]!.id, takeReturn: true })
              : setReturnsOpen(true)
          }
          accessibilityRole="button"
        >
          <Icon name="return" size={15} color={colors.warnInk} strokeWidth={2.2} />
          <Text style={s.returnsText} numberOfLines={1}>
            {pendingReturns.length > 1
              ? t('home.returnReminderMany', { n: pendingReturns.length })
              : t('home.returnReminder')}
          </Text>
          <Icon name="chevron-right" size={15} color={colors.warn} strokeWidth={2.5} />
        </Pressable>
      )}

      <Sheet visible={returnsOpen} onClose={() => setReturnsOpen(false)} title={t('home.returnReminderTitle')}>
        {pendingReturns.map((o) => (
          <Pressable
            key={o.id}
            onPress={() => {
              setReturnsOpen(false);
              nav.navigate('OrderDetail', { id: o.id, takeReturn: true });
            }}
            accessibilityRole="button"
            style={s.returnRow}
          >
            <Icon name="return" size={17} color={colors.warnInk} strokeWidth={2.2} />
            <View style={{ flex: 1 }}>
              <Text style={s.returnRowTitle} numberOfLines={1}>{o.client_name}</Text>
              <Text style={s.returnRowSub} numberOfLines={1}>
                {placeOf(o) ? t('home.returnTo', { place: placeOf(o) }) : t('home.returnPlacePending')}
              </Text>
            </View>
            <Icon name="chevron-right" size={16} color={colors.slateLt} strokeWidth={2.5} />
          </Pressable>
        ))}
      </Sheet>

      <Modal
        visible={shift.reasonMode !== null}
        transparent
        animationType="fade"
        onRequestClose={shift.closeReason}
      >
        <View style={[s.modalOverlay, keyboard > 0 && { paddingBottom: keyboard }]}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>
              {shift.reasonMode === 'late' ? t('profile.lateTitle') : t('profile.earlyTitle')}
            </Text>
            <Text style={s.modalMsg}>
              {shift.reasonMode === 'late' ? t('profile.lateMessage') : t('profile.earlyMessage')}
            </Text>
            <TextInput
              style={s.modalInput}
              value={shift.reasonText}
              onChangeText={shift.setReasonText}
              placeholder={t('profile.reasonPlaceholder')}
              placeholderTextColor={colors.slateLt}
              multiline
              autoFocus
            />
            <View style={s.modalActions}>
              <Pressable onPress={shift.closeReason} style={[s.modalBtn, s.modalCancel]}>
                <Text style={s.modalCancelText}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (!shift.reasonText.trim()) {
                    Alert.alert(t('common.completeRequiredFields'));
                    return;
                  }
                  shift.submitReason();
                }}
                disabled={shift.pending}
                style={[
                  s.modalBtn,
                  s.modalConfirm,
                  shift.pending && { opacity: 0.5 },
                ]}
              >
                <Text style={s.modalConfirmText}>{t('profile.submitReason')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.mist,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  identity: { flex: 1, gap: 1 },
  name: { fontSize: 16, fontWeight: '800', color: colors.ink },
  // The lorry line read too small under the name (owner, 03.11.2026).
  vehicle: { fontSize: 15, fontWeight: '700', color: colors.slate, marginTop: 2 },
  // A bordered square matching the Chiqish button beside it, so the two read as
  // one pair of controls rather than a bare glyph next to a button.
  bell: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.mist,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellDot: {
    position: 'absolute',
    top: 6,
    right: 7,
    width: 8,
    height: 8,
    borderRadius: 99,
    backgroundColor: colors.brand,
    borderWidth: 1.5,
    borderColor: colors.white,
  },
  // A little larger than the stock switch, so it reads beside the 36px buttons.
  switch: { marginRight: 4, transform: [{ scaleX: 1.25 }, { scaleY: 1.25 }] },
  returns: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    backgroundColor: colors.warnBg,
    borderWidth: 1,
    borderColor: colors.warnBorder,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  returnsText: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.warnInk },
  returnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.mist,
  },
  returnRowTitle: { fontSize: 16, fontWeight: '800', color: colors.ink },
  returnRowSub: { marginTop: 2, fontSize: 13, color: colors.slate },
  shiftLabel: { fontSize: 13, fontWeight: '700' },
  shiftOn: { color: colors.success },
  shiftOff: { color: colors.slate },
  signOut: {
    height: 36,
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.mist,
    paddingHorizontal: 12,
  },
  signOutText: { fontSize: 13, fontWeight: '700', color: colors.slate },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(20,24,31,0.45)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: { borderRadius: 16, backgroundColor: colors.white, padding: 20 },
  modalTitle: { fontSize: 17, fontWeight: '700', color: colors.ink },
  modalMsg: { marginTop: 6, fontSize: 14, color: colors.slate },
  modalInput: {
    marginTop: 14,
    minHeight: 80,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.mist,
    padding: 12,
    fontSize: 15,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  modalActions: { marginTop: 16, flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  modalBtn: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  modalCancel: { backgroundColor: colors.paper },
  modalCancelText: { fontSize: 14, fontWeight: '600', color: colors.slate },
  modalConfirm: { backgroundColor: colors.brand },
  modalConfirmText: { fontSize: 14, fontWeight: '700', color: colors.onAccent },
});
