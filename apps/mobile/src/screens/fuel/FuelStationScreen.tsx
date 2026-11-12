import { useEffect, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { FUEL_STATION_FENCE_RADIUS_M, type DriverMe } from '@bigant/shared';
import { api } from '../../lib/api';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { colors } from '../../components/theme';
import { useFuelPhoto } from '../../hooks/useFuelPhoto';
import { distanceMeters, fuelLabel } from '../../lib/fuel';
import { openRoute } from '../../lib/navigation';
import type { RootStackParams } from '../../navigation/RootNavigator';
import { ScreenHeader } from '../../components/ScreenHeader';
import { PrimaryButton, SecondaryButton, f, FuelScreen } from './fuelUi';

type Nav = NativeStackNavigationProp<RootStackParams>;
type Route = RouteProp<RootStackParams, 'FuelStation'>;

/**
 * Step 3: the station the driver picked, the way there, and — once he is
 * there — the camera.
 *
 * The phone's position is watched while this screen is open. Outside the
 * station's fence the one big button is Yo'nalish: the navigator takes him
 * there. Inside it the screen says "Siz keldingiz" and the big button
 * becomes the camera. A station with no pin cannot be driven to, so it is
 * never gated; and the office can switch the gate off for testing.
 */
export function FuelStationScreen() {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const { fuelType, station, distanceM } = useRoute<Route>().params;
  const photo = useFuelPhoto();

  // Live distance to the pump, from the phone's own position.
  const [liveM, setLiveM] = useState<number | null>(distanceM ?? null);
  useEffect(() => {
    if (Platform.OS === 'web' || station.lat == null || station.lng == null) return undefined;
    let sub: { remove: () => void } | null = null;
    let stopped = false;
    void (async () => {
      try {
        const Location = await import('expo-location');
        const perm = await Location.requestForegroundPermissionsAsync();
        if (!perm.granted || stopped) return;
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 4000, distanceInterval: 5 },
          (pos) => {
            setLiveM(
              distanceMeters(
                { lat: pos.coords.latitude, lng: pos.coords.longitude },
                { lat: station.lat!, lng: station.lng! },
              ),
            );
          },
        );
      } catch {
        // No position: the distance the picker measured stands.
      }
    })();
    return () => {
      stopped = true;
      sub?.remove();
    };
  }, [station.lat, station.lng]);
  const cfg = useQuery({
    queryKey: ['fuel', 'config'],
    queryFn: () => api.get<{ fence_check: boolean; fence_radius_m: number }>('/fuel/config'),
    staleTime: 10 * 60_000,
  });
  const gated = cfg.data?.fence_check ?? true;
  const radius = cfg.data?.fence_radius_m ?? FUEL_STATION_FENCE_RADIUS_M;


  const pinned = station.lat != null && station.lng != null;
  // Test accounts (90 000 00 0X) can say "I am there" without driving: the
  // owner tries the flow from his desk. Real drivers never see it.
  const me = useQuery({ queryKey: ['driver', 'me'], queryFn: () => api.get<DriverMe>('/drivers/me'), staleTime: 60_000 });
  const testDriver = /^\+99890000000\d$/.test(me.data?.phone_number ?? '');
  const [testArrived, setTestArrived] = useState(false);
  // By the phone's own distance to the pump, whatever the server enforces;
  // with no position at all, the server's rule decides.
  const arrived = !pinned || testArrived || (liveM != null ? liveM <= radius : !gated);
  const route = async () => {
    if (!pinned) return;
    const opened = await openRoute({ lat: station.lat!, lng: station.lng!, label: station.name });
    if (!opened) Alert.alert(t('fuel.routeFailed'));
  };
  const shoot = async () => {
    const shot = await photo.take();
    if (!shot) return;
    nav.navigate('FuelReview', { fuelType, station, shot });
  };

  return (
    <FuelScreen>
      <ScreenHeader title={t('fuel.pickerTitle', { fuel: fuelLabel(t, fuelType) })} />
      {/* One thing at a time (owner, 29.10.2026): on the way, where to go;
          in the zone, "Siz yetib keldingiz" and the photo button under it. */}
      <View style={f.body}>
        <View style={f.spacer} />
        <View style={[s.state, arrived ? s.stateOk : s.stateWait]}>
          <Text style={[s.stateText, arrived ? s.stateTextOk : s.stateTextWait]}>
            {arrived ? t('fuel.arrived') : t('fuel.notArrived')}
          </Text>
        </View>
        <View style={f.spacer} />
        {arrived ? (
          <PrimaryButton label={t('fuel.takePhoto')} icon="camera" onPress={() => void shoot()} disabled={photo.busy} />
        ) : (
          <>
            {/* Navigator closed before getting there: the way again. */}
            <PrimaryButton label={t('fuel.routeButton')} icon="navigation" onPress={() => void route()} />
            {testDriver ? (
              <SecondaryButton label={t('fuel.testArrive')} onPress={() => setTestArrived(true)} />
            ) : null}
          </>
        )}
      </View>
    </FuelScreen>
  );
}

const s = StyleSheet.create({
  selected: { borderWidth: 1.5, borderColor: colors.brand, borderRadius: 18, gap: 6, paddingVertical: 18 },
  name: { fontSize: 26, fontWeight: '800', color: colors.ink, lineHeight: 30, letterSpacing: -0.3 },
  address: { fontSize: 15, color: colors.slate },
  distRow: { marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 6 },
  dist: { fontSize: 14, fontWeight: '700', color: colors.brand },
  state: { borderRadius: 18, paddingVertical: 28, paddingHorizontal: 16, alignItems: 'center' },
  stateOk: { backgroundColor: colors.successBg },
  stateWait: { backgroundColor: colors.warnBg },
  stateText: { fontSize: 24, fontWeight: '800', textAlign: 'center' },
  stateTextOk: { color: colors.success },
  stateTextWait: { color: colors.warnInk },
});
