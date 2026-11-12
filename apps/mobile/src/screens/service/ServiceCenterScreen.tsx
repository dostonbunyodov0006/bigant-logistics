import { Alert, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { ScreenHeader } from '../../components/ScreenHeader';
import { colors } from '../../components/theme';
import { useStartServiceVisit } from '../../hooks/useStartServiceVisit';
import { formatDistance } from '../../lib/fuel';
import { openRoute } from '../../lib/navigation';
import type { RootStackParams } from '../../navigation/RootNavigator';
import { Card, Eyebrow, FuelScreen, PrimaryButton, SecondaryButton, f } from '../fuel/fuelUi';

type Nav = NativeStackNavigationProp<RootStackParams>;
type Route = RouteProp<RootStackParams, 'ServiceCenter'>;

/**
 * The centre the driver picked, and the one button that matters: I am here.
 * Yo'nalish is there for the drive over; the start is pressed on arrival,
 * because that is when the position means something.
 */
export function ServiceCenterScreen() {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const { center, distanceM, visitId, works } = useRoute<Route>().params;
  const starter = useStartServiceVisit();
  const pinned = center.lat != null && center.lng != null;
  // A route in the navigator, not a pin on a map: the same as every other
  // Yo'nalish in the app.
  const route = async () => {
    const opened = await openRoute({ lat: center.lat!, lng: center.lng!, label: center.name });
    if (!opened) Alert.alert(t('fuel.routeFailed'));
  };

  return (
    <FuelScreen>
      <ScreenHeader title={t('service.pickerTitle')} />
      <View style={f.body}>
        <Card style={s.selected}>
          <Eyebrow tone="brand">{t('service.selectedHeading')}</Eyebrow>
          <Text style={s.name}>{center.name}</Text>
          {center.address || center.brand ? (
            <Text style={s.address}>{[center.address, center.brand].filter(Boolean).join(' · ')}</Text>
          ) : null}
          {distanceM != null && (
            <View style={s.distRow}>
              <Icon name="pin" size={15} color={colors.brand} strokeWidth={2.2} />
              <Text style={s.dist}>{t('fuel.fromYou', { d: formatDistance(distanceM) })}</Text>
            </View>
          )}
        </Card>

        <Card style={{ gap: 6 }}>
          <Eyebrow>{t('fuel.whatToDo')}</Eyebrow>
        </Card>

        <View style={f.spacer} />

        <PrimaryButton
          label={t('service.hereStart')}
          icon="pin"
          onPress={() => void starter.start({ visitId, works, center })}
          disabled={starter.busy}
        />
        <View style={f.row}>
          {pinned && (
            <SecondaryButton label={t('fuel.navigate')} icon="navigation" onPress={() => void route()} />
          )}
          <SecondaryButton label={t('service.otherCenter')} onPress={() => nav.goBack()} />
        </View>
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
});
