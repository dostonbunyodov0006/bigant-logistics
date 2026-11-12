import { useEffect, useState } from 'react';
import { AppState, Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { api, netState } from '../lib/api';
import { useQuery } from '@tanstack/react-query';
import type { DriverMe } from '@bigant/shared';
import { locationBacklog } from '../lib/locationQueue';
import { openGpsSettings } from '../lib/backgroundLocation';
import { gpsGuard, gpsRequiredNow } from '../lib/gpsGuard';

const RED = '#b91c1c';

/**
 * GPS and internet, on every screen of the driver's app (owner, 04.11.2026).
 * GPS off: a red screen over everything, one button to turn it on, nothing
 * else can be pressed until it is on — looked at every two seconds and the
 * moment the app comes back. No internet: a red bar across the top; the app
 * keeps the positions and sends them when it is back.
 */
export function ConnectionGuard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const isDriver = user?.role === 'driver' && Platform.OS !== 'web';

  const me = useQuery({
    queryKey: ['driver', 'me'],
    queryFn: () => api.get<DriverMe>('/drivers/me'),
    enabled: isDriver,
    refetchInterval: 15_000,
  });
  const onShift = !!me.data?.shift_started_at;
  // GPS is required in working hours, or while an order or return is in hand (owner, 04.11.2026).
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  // On a break, and late back from it, GPS alone is asked (owner, 12.11.2026):
  // the server sends that as gps_only, and nothing else then.
  const required = onShift && (gpsRequiredNow(me.data?.gps_required) || gpsRequiredNow(me.data?.gps_only));

  const [gpsOff, setGpsOff] = useState(false);
  const [noOverlay, setNoOverlay] = useState(false);
  const [noBattery, setNoBattery] = useState(false);
  const [noAutostart, setNoAutostart] = useState(false);
  // iPhone (10.11.2026): location turned down from "Always" to "While Using"
  // on shift — the position stops with the screen off. Android has its own checks.
  const [iosNoAlways, setIosNoAlways] = useState(false);
  // iPhone: the battery saver (Low Power Mode) holds the position back.
  const [iosLowPower, setIosLowPower] = useState(false);
  useEffect(() => {
    if (!isDriver) {
      setGpsOff(false);
      return;
    }
    const look = () => {
      setNoOverlay(!gpsGuard.canDrawOverlays());
      setNoBattery(!gpsGuard.batteryUnrestricted());
      setNoAutostart(gpsGuard.autostartNeeded());
      void Location.hasServicesEnabledAsync()
        .then((on) => setGpsOff(!on))
        .catch(() => undefined);
      if (Platform.OS === 'ios') {
        void Promise.resolve()
          .then(() => Location.getBackgroundPermissionsAsync())
          .then((p) => setIosNoAlways(!p.granted))
          .catch(() => undefined);
        // Loaded only on iPhone: the Android APKs out there do not carry it.
        void Promise.resolve()
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          .then(() => (require('expo-battery') as typeof import('expo-battery')).isLowPowerModeEnabledAsync())
          .then(setIosLowPower)
          .catch(() => undefined);
      }
    };
    look();
    const timer = setInterval(look, 2_000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') look();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [isDriver]);

  // iPhone (owner, 10.11.2026): the office hears at once when location services
  // go off or the battery saver comes on during the shift — sent on a change only.
  useEffect(() => {
    if (Platform.OS !== 'ios' || !isDriver || !onShift) return;
    void Promise.resolve()
      .then(() => api.post('/app-health/device-state', { gps_off: gpsOff, low_power: iosLowPower }))
      .catch(() => undefined);
  }, [isDriver, onShift, gpsOff, iosLowPower]);

  const [online, setOnline] = useState(netState.get());
  useEffect(() => netState.subscribe(setOnline), []);
  const [backlog, setBacklog] = useState(locationBacklog.get());
  useEffect(() => locationBacklog.subscribe(setBacklog), []);

  if (!isDriver) return null;
  // On an APK with the guard the phone draws the full red screen itself; the
  // bar is for older APKs only (owner, 04.11.2026).
  const noInternet = !gpsGuard.available() && (!online || backlog > 0);

  return (
    <>
      {noInternet && !(gpsOff && required) ? (
        <View pointerEvents="none" style={[s.bar, { paddingTop: insets.top + 8 }]}>
          <Text style={s.barTitle}>{t('guard.netOffTitle')}</Text>
          <Text style={s.barBody}>{t('guard.netOffBody')}</Text>
        </View>
      ) : null}
      <Modal visible={!gpsOff && onShift && noOverlay} animationType="fade" statusBarTranslucent onRequestClose={() => undefined}>
        <View style={[s.screen, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
          <Text style={s.icon}>!</Text>
          <Text style={s.title}>{t('guard.overlayBlockTitle')}</Text>
          <Text style={s.body}>{t('guard.overlayBlockBody')}</Text>
          <Pressable onPress={() => gpsGuard.openOverlaySettings()} accessibilityRole="button" style={s.button}>
            <Text style={s.buttonText}>{t('guard.overlayButton')}</Text>
          </Pressable>
        </View>
      </Modal>
      {/* Battery "Без ограничений" (owner, 04.11.2026): without it the phone puts the
          app to sleep with the screen off and the position stops coming. Asked here
          too, for a driver who was already on shift when the APK came. */}
      <Modal visible={!gpsOff && onShift && !noOverlay && noBattery} animationType="fade" statusBarTranslucent onRequestClose={() => undefined}>
        <View style={[s.screen, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
          <Text style={s.icon}>!</Text>
          <Text style={s.title}>{t('guard.batteryBlockTitle')}</Text>
          <Text style={s.body}>{t('guard.batteryBlockBody')}</Text>
          <Pressable onPress={() => gpsGuard.requestBatteryUnrestricted()} accessibilityRole="button" style={s.button}>
            <Text style={s.buttonText}>{t('guard.overlayButton')}</Text>
          </Pressable>
        </View>
      </Modal>
      {/* Xiaomi, Oppo, Vivo, Huawei: their own autostart switch (owner, 05.11.2026). */}
      <Modal visible={!gpsOff && onShift && !noOverlay && !noBattery && noAutostart} animationType="fade" statusBarTranslucent onRequestClose={() => undefined}>
        <View style={[s.screen, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
          <Text style={s.icon}>!</Text>
          <Text style={s.title}>{t('guard.autostartBlockTitle')}</Text>
          <Text style={s.body}>{t('guard.autostartBlockBody')}</Text>
          <Pressable onPress={() => gpsGuard.openAutostart()} accessibilityRole="button" style={s.button}>
            <Text style={s.buttonText}>{t('guard.autostartOpen')}</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              gpsGuard.confirmAutostart();
              setNoAutostart(false);
            }}
            accessibilityRole="button"
            style={s.secondButton}
          >
            <Text style={s.secondButtonText}>{t('guard.autostartDone')}</Text>
          </Pressable>
        </View>
      </Modal>
      <Modal
        visible={Platform.OS === 'ios' && !gpsOff && onShift && !iosNoAlways && iosLowPower}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => undefined}
      >
        <View style={[s.screen, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
          <Text style={s.icon}>!</Text>
          <Text style={s.title}>{t('guard.iosLowPowerTitle')}</Text>
          <Text style={s.body}>{t('guard.iosLowPowerBody')}</Text>
        </View>
      </Modal>
      <Modal
        visible={Platform.OS === 'ios' && !gpsOff && onShift && iosNoAlways}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => undefined}
      >
        <View style={[s.screen, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
          <Text style={s.icon}>!</Text>
          <Text style={s.title}>{t('guard.iosAlwaysTitle')}</Text>
          <Text style={s.body}>{t('guard.iosAlwaysBody')}</Text>
          <Pressable onPress={() => void Linking.openSettings()} accessibilityRole="button" style={s.button}>
            <Text style={s.buttonText}>{t('guard.overlayButton')}</Text>
          </Pressable>
        </View>
      </Modal>
      <Modal visible={gpsOff && required} animationType="fade" statusBarTranslucent onRequestClose={() => undefined}>
        <View style={[s.screen, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
          <Text style={s.icon}>!</Text>
          <Text style={s.title}>{t('guard.gpsOffTitle')}</Text>
          <Text style={s.body}>{t('guard.gpsOffBody')}</Text>
          <Pressable onPress={() => void openGpsSettings()} accessibilityRole="button" style={s.button}>
            <Text style={s.buttonText}>{t('guard.gpsTurnOn')}</Text>
          </Pressable>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    elevation: 1000,
    backgroundColor: RED,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  barTitle: { color: '#ffffff', fontSize: 17, fontWeight: '900', textAlign: 'center' },
  barBody: { color: '#ffffff', fontSize: 13, fontWeight: '600', textAlign: 'center', marginTop: 2 },
  screen: { flex: 1, backgroundColor: RED, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 14 },
  icon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 5,
    borderColor: '#ffffff',
    color: '#ffffff',
    fontSize: 60,
    fontWeight: '900',
    textAlign: 'center',
    lineHeight: 86,
  },
  title: { color: '#ffffff', fontSize: 30, fontWeight: '900', textAlign: 'center' },
  body: { color: '#ffffff', fontSize: 18, lineHeight: 25, fontWeight: '600', textAlign: 'center' },
  button: { alignSelf: 'stretch', marginTop: 18, backgroundColor: '#ffffff', borderRadius: 16, paddingVertical: 18, alignItems: 'center' },
  buttonText: { color: RED, fontSize: 20, fontWeight: '900' },
  secondButton: { alignSelf: 'stretch', marginTop: 4, borderWidth: 2, borderColor: '#ffffff', borderRadius: 16, paddingVertical: 15, alignItems: 'center' },
  secondButtonText: { color: '#ffffff', fontSize: 18, fontWeight: '900' },
});
