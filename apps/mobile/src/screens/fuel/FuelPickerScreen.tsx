import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FUEL_STATION_FENCE_RADIUS_M, type FuelStation, type NearbyFuelStation } from '@bigant/shared';
import { api } from '../../lib/api';
import { captureFix, formatDistance, fuelLabel, type CaptureFix } from '../../lib/fuel';
import { useFuelPhoto } from '../../hooks/useFuelPhoto';
import { Icon } from '../../components/Icon';
import { EmptyState, ErrorBanner, Spinner } from '../../components/ui';
import { errorText } from '../../lib/errorText';
import { colors } from '../../components/theme';
import { openRoute } from '../../lib/navigation';
import type { RootStackParams } from '../../navigation/RootNavigator';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Card, Eyebrow, PrimaryButton, Segmented, f, FuelScreen } from './fuelUi';

type Nav = NativeStackNavigationProp<RootStackParams>;
type Route = RouteProp<RootStackParams, 'FuelPicker'>;
type Mode = 'near' | 'list' | 'street';

/**
 * Step 2: which station. Three ways in, one row of pills.
 *
 * Yaqinimda asks the phone where it is and shows the three nearest contracted
 * stations within 3 km. Standing inside one of them (within its fence) the
 * driver is taken straight to its camera screen — no tap needed. Ro'yxat is every contracted station with a search
 * box. Ko'cha picks nothing — it is the path for a station that is not ours,
 * and goes straight to the camera.
 */
export function FuelPickerScreen() {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const { fuelType } = useRoute<Route>().params;
  const [mode, setMode] = useState<Mode>('near');


  const open = (station: FuelStation, distanceM: number | null, auto = false) =>
    nav.navigate('FuelStation', { fuelType, station, distanceM, auto });

  return (
    <FuelScreen>
      <ScreenHeader title={t('fuel.pickerTitle', { fuel: fuelLabel(t, fuelType) })} />
      <ScrollView contentContainerStyle={f.body} keyboardShouldPersistTaps="handled">
        <Segmented
          value={mode}
          onChange={setMode}
          items={[
            { key: 'near', label: t('fuel.near'), icon: 'pin' },
            { key: 'list', label: t('fuel.list'), icon: 'list' },
            { key: 'street', label: t('fuel.street'), icon: 'road' },
          ]}
        />
        {mode === 'near' && <NearMe fuelType={fuelType} onPick={open} />}
        {mode === 'list' && <StationList fuelType={fuelType} onPick={open} />}
        {mode === 'street' && <Street fuelType={fuelType} />}
      </ScrollView>
    </FuelScreen>
  );
}

function NearMe({
  fuelType,
  onPick,
}: {
  fuelType: RootStackParams['FuelPicker']['fuelType'];
  onPick: (s: FuelStation, d: number, auto?: boolean) => void;
}) {
  const { t } = useTranslation();
  const [fix, setFix] = useState<CaptureFix | null | 'pending'>('pending');
  // Once per visit: coming back with "Boshqa shoxobcha" must show the list.
  const autoPicked = useRef(false);
  useEffect(() => {
    let alive = true;
    void captureFix().then((p) => alive && setFix(p));
    return () => {
      alive = false;
    };
  }, []);

  const q = useQuery({
    queryKey: ['fuel', 'nearby', fuelType, fix !== 'pending' && fix ? `${fix.lat},${fix.lng}` : null],
    enabled: fix !== 'pending' && fix !== null,
    queryFn: () =>
      api.get<NearbyFuelStation[]>(
        `/fuel/stations/nearby?lat=${(fix as CaptureFix).lat}&lng=${(fix as CaptureFix).lng}&fuel_type=${fuelType}`,
      ),
  });

  // Inside a contracted station's fence: that is where the driver is.
  useEffect(() => {
    const first = q.data?.[0];
    if (!first || autoPicked.current || first.distance_m > FUEL_STATION_FENCE_RADIUS_M) return;
    autoPicked.current = true;
    onPick(first, first.distance_m, true);
  }, [q.data, onPick]);

  if (fix === 'pending') return <Spinner label={t('fuel.locating')} />;
  if (fix === null) return <EmptyState title={t('fuel.locationDenied')} />;
  if (q.isLoading) return <Spinner />;
  // A failed request is not "no stations nearby" (audit, 07.11.2026): it is
  // said as an error, with a retry.
  if (q.isError && !q.data) {
    return (
      <>
        <ErrorBanner message={errorText(q.error)} />
        <PrimaryButton label={t('common.retry')} onPress={() => void q.refetch()} disabled={q.isFetching} />
      </>
    );
  }
  const near = q.data ?? [];
  const [nearest, ...rest] = near;

  if (!nearest) return <EmptyState title={t('fuel.nearEmpty')} hint={t('fuel.nearEmptyHint')} />;

  return (
    <>
      {/* Marshrut only: the navigator opens on the tap itself, and the station
          screen waits behind it to say "Siz keldingiz" when he is back. */}
      <NearestCard station={nearest} onRoute={() => onPick(nearest, nearest.distance_m)} />
      {rest.length > 0 && (
        <>
          <Eyebrow>{t('fuel.otherNear')}</Eyebrow>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {rest.map((st, i) => (
              <StationRow
                key={st.id}
                station={st}
                sub={[st.brand, st.address].filter(Boolean).join(' · ')}
                distance={formatDistance(st.distance_m)}
                first={i === 0}
                onPress={() => onPick(st, st.distance_m)}
              />
            ))}
          </Card>
        </>
      )}
    </>
  );
}

/**
 * The nearest station, as a card the driver can act on from wherever he is.
 *
 * Two things are wanted at that moment and nothing else: which station, and
 * take me there. The name is the biggest thing on the screen because that is
 * what he says out loud ("Yujniy"), the distance sits next to it, and Marshrut
 * hands the route to Yandex Navigator, which knows Tashkent's traffic.
 */
function NearestCard({ station, onRoute }: { station: NearbyFuelStation; onRoute: () => void }) {
  const { t } = useTranslation();
  // Opened on the tap itself: Android opens another app reliably only from a
  // press, and a navigator started from the next screen's mount did not show.
  const route = async () => {
    if (station.lat == null || station.lng == null) {
      Alert.alert(t('fuel.noPin'));
      return;
    }
    const opened = await openRoute({ lat: station.lat, lng: station.lng, label: station.name });
    if (!opened) Alert.alert(t('fuel.routeFailed'));
    onRoute();
  };

  const sub = [station.brand, station.address].filter(Boolean).join(' · ');
  return (
    <Card style={{ padding: 18, gap: 4, borderRadius: 18 }}>
      <Text style={h.eyebrow}>{t('fuel.nearestEyebrow')}</Text>
      <Text style={h.name} numberOfLines={2}>
        {station.name}
      </Text>
      <Text style={h.distance}>{formatDistance(station.distance_m)}</Text>
      {sub ? (
        <Text style={h.sub} numberOfLines={2}>
          {sub}
        </Text>
      ) : null}
      <View style={h.actions}>
        <Pressable onPress={() => void route()} accessibilityRole="button" style={[h.routeBtn, { flex: 1 }]}>
          <Icon name="navigation" size={18} color={colors.onAccent} strokeWidth={2.4} />
          <Text style={h.routeText}>{t('fuel.routeButton')}</Text>
        </Pressable>
      </View>
    </Card>
  );
}

const h = StyleSheet.create({
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, color: colors.slateLt },
  name: { fontSize: 26, fontWeight: '800', color: colors.ink },
  distance: { fontSize: 18, fontWeight: '800', color: colors.brand, fontVariant: ['tabular-nums'] },
  sub: { fontSize: 14, color: colors.slate, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  routeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.brand,
  },
  routeText: { fontSize: 16, fontWeight: '800', color: colors.onAccent },
  useBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.mist,
    backgroundColor: colors.white,
  },
  useText: { fontSize: 16, fontWeight: '700', color: colors.ink },
});

function StationList({
  fuelType,
  onPick,
}: {
  fuelType: RootStackParams['FuelPicker']['fuelType'];
  onPick: (s: FuelStation, d: null) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const q = useQuery({
    queryKey: ['fuel', 'stations', fuelType],
    queryFn: () => api.get<FuelStation[]>(`/fuel/stations?fuel_type=${fuelType}`),
  });
  const items = useMemo(() => {
    const all = q.data ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((s) =>
      [s.name, s.brand, s.address].some((v) => v?.toLowerCase().includes(needle)),
    );
  }, [q.data, query]);

  return (
    <>
      <View style={s.search}>
        <Icon name="search" size={18} color={colors.slateLt} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('fuel.searchPlaceholder')}
          placeholderTextColor={colors.slateLt}
          style={s.searchInput}
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>
      {q.isLoading ? (
        <Spinner />
      ) : (
        <>
          <Eyebrow>{t('fuel.listHeading', { n: items.length })}</Eyebrow>
          {items.length === 0 ? (
            <EmptyState title={t('fuel.listEmpty')} />
          ) : (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {items.map((st, i) => (
                <StationRow
                  key={st.id}
                  station={st}
                  sub={[st.brand, st.address].filter(Boolean).join(' · ')}
                  first={i === 0}
                  onPress={() => onPick(st, null)}
                />
              ))}
            </Card>
          )}
        </>
      )}
    </>
  );
}

/** Ko'cha: no station. Explain what that means, then the camera. */
function Street({ fuelType }: { fuelType: RootStackParams['FuelPicker']['fuelType'] }) {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const photo = useFuelPhoto();

  const shoot = async () => {
    const shot = await photo.take();
    if (!shot) return;
    nav.navigate('FuelReview', { fuelType, station: null, shot });
  };

  return (
    <>
      <Card style={{ padding: 22, gap: 10, alignItems: 'flex-start', borderRadius: 18 }}>
        <View style={s.streetIcon}>
          <Icon name="road" size={24} color={colors.slate} />
        </View>
        <Text style={{ fontSize: 20, fontWeight: '800', color: colors.ink }}>{t('fuel.streetTitle')}</Text>
      </Card>
      <View style={f.spacer} />
      <PrimaryButton label={t('fuel.takePhoto')} icon="camera" onPress={() => void shoot()} disabled={photo.busy} />
    </>
  );
}

function StationRow({
  station,
  sub,
  distance,
  first,
  onPress,
}: {
  station: FuelStation;
  sub: string;
  distance?: string;
  first: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={[s.row, !first && s.rowDivider]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.rowName} numberOfLines={1}>
          {station.name}
        </Text>
        {sub ? (
          <Text style={s.rowSub} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      {distance ? <Text style={s.rowDist}>{distance}</Text> : null}
      <Icon name="chevron-right" size={18} color={colors.slateLt} strokeWidth={2.4} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.mist },
  rowName: { fontSize: 16, fontWeight: '700', color: colors.ink },
  rowSub: { fontSize: 14, color: colors.slate, fontWeight: '600' },
  rowDist: { fontSize: 14, fontWeight: '800', color: colors.brand, fontVariant: ['tabular-nums'] },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.mist,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 48,
  },
  searchInput: { flex: 1, fontSize: 16, color: colors.ink },
  streetIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: colors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
