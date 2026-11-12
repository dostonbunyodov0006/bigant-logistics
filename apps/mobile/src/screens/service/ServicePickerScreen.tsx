import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { NearbyServiceCenter, ServiceCenter } from '@bigant/shared';
import { api } from '../../lib/api';
import { captureFix, formatDistance, type CaptureFix } from '../../lib/fuel';
import { useStartServiceVisit } from '../../hooks/useStartServiceVisit';
import { Icon } from '../../components/Icon';
import { ScreenHeader } from '../../components/ScreenHeader';
import { EmptyState, Spinner } from '../../components/ui';
import { colors } from '../../components/theme';
import type { RootStackParams } from '../../navigation/RootNavigator';
import { Card, Eyebrow, FuelScreen, PrimaryButton, Segmented, f } from '../fuel/fuelUi';

type Nav = NativeStackNavigationProp<RootStackParams>;
type Route = RouteProp<RootStackParams, 'ServicePicker'>;
type Mode = 'near' | 'list' | 'street';

/**
 * Which centre — the fuel picker with service centres in the list.
 *
 * Reached two ways: from "Hozir boraman" with the works in hand (no visit
 * yet), or from the home card of an approved request (visit exists). Either
 * way the next tap is a centre, or Ko'cha for a mechanic not on our list.
 */
export function ServicePickerScreen() {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const params = useRoute<Route>().params;
  const [mode, setMode] = useState<Mode>('near');

  const open = (center: ServiceCenter, distanceM: number | null) =>
    nav.navigate('ServiceCenter', { ...params, center, distanceM });

  return (
    <FuelScreen>
      <ScreenHeader title={t('service.pickerTitle')} />
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
        {mode === 'near' && <NearMe onPick={open} />}
        {mode === 'list' && <CenterList onPick={open} />}
        {mode === 'street' && <Street params={params} />}
      </ScrollView>
    </FuelScreen>
  );
}

function NearMe({ onPick }: { onPick: (c: ServiceCenter, d: number) => void }) {
  const { t } = useTranslation();
  const [fix, setFix] = useState<CaptureFix | null | 'pending'>('pending');
  useEffect(() => {
    let alive = true;
    void captureFix().then((p) => alive && setFix(p));
    return () => {
      alive = false;
    };
  }, []);

  const q = useQuery({
    queryKey: ['service', 'centers', 'nearby', fix !== 'pending' && fix ? `${fix.lat},${fix.lng}` : null],
    enabled: fix !== 'pending' && fix !== null,
    queryFn: () =>
      api.get<NearbyServiceCenter[]>(`/service/centers/nearby?lat=${(fix as CaptureFix).lat}&lng=${(fix as CaptureFix).lng}`),
  });

  if (fix === 'pending') return <Spinner label={t('fuel.locating')} />;
  if (fix === null) return <EmptyState title={t('fuel.locationDenied')} />;
  if (q.isLoading) return <Spinner />;
  const near = q.data ?? [];

  return (
    <>
      <Eyebrow>{t('service.nearHeading')}</Eyebrow>
      {near.length === 0 ? (
        <EmptyState title={t('service.nearEmpty')} hint={t('service.nearEmptyHint')} />
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {near.map((c, i) => (
            <CenterRow key={c.id} center={c} distance={formatDistance(c.distance_m)} first={i === 0} onPress={() => onPick(c, c.distance_m)} />
          ))}
        </Card>
      )}
    </>
  );
}

function CenterList({ onPick }: { onPick: (c: ServiceCenter, d: null) => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const q = useQuery({ queryKey: ['service', 'centers'], queryFn: () => api.get<ServiceCenter[]>('/service/centers') });
  const items = useMemo(() => {
    const all = q.data ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((c) => [c.name, c.brand, c.address].some((v) => v?.toLowerCase().includes(needle)));
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
          <Eyebrow>{t('service.listHeading', { n: items.length })}</Eyebrow>
          {items.length === 0 ? (
            <EmptyState title={t('fuel.listEmpty')} />
          ) : (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {items.map((c, i) => (
                <CenterRow key={c.id} center={c} first={i === 0} onPress={() => onPick(c, null)} />
              ))}
            </Card>
          )}
        </>
      )}
    </>
  );
}

/** Ko'cha: no centre. Say what that means, then start right here. */
function Street({ params }: { params: RootStackParams['ServicePicker'] }) {
  const { t } = useTranslation();
  const starter = useStartServiceVisit();
  return (
    <>
      <Card style={{ padding: 22, gap: 10, alignItems: 'flex-start', borderRadius: 18 }}>
        <View style={s.streetIcon}>
          <Icon name="road" size={24} color={colors.slate} />
        </View>
        <Text style={{ fontSize: 20, fontWeight: '800', color: colors.ink }}>{t('service.streetTitle')}</Text>
      </Card>
      <View style={f.spacer} />
      <PrimaryButton
        label={t('service.hereStart')}
        icon="pin"
        onPress={() => void starter.start({ visitId: params.visitId, works: params.works, center: null })}
        disabled={starter.busy}
      />
    </>
  );
}

function CenterRow({ center, distance, first, onPress }: { center: ServiceCenter; distance?: string; first: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  const sub = [center.contracted ? t('service.contracted') : null, center.brand, center.address].filter(Boolean).join(' · ');
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={[s.row, !first && s.rowDivider]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.rowName} numberOfLines={1}>
          {center.name}
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
  streetIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: colors.chip, alignItems: 'center', justifyContent: 'center' },
});
