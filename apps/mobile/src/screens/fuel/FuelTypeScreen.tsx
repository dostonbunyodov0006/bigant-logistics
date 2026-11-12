import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { FUEL_TYPES, type FuelType } from '@bigant/shared';
import { Icon } from '../../components/Icon';
import { colors } from '../../components/theme';
import { fuelLabel, unitLabel } from '../../lib/fuel';
import type { RootStackParams } from '../../navigation/RootNavigator';
import { ScreenHeader } from '../../components/ScreenHeader';
import { f, FuelScreen } from './fuelUi';

type Nav = NativeStackNavigationProp<RootStackParams>;

/** Step 1: which fuel. Asked every time; the unit follows the answer. */
export function FuelTypeScreen() {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();

  return (
    <FuelScreen>
      <ScreenHeader title={t('fuel.open')} />
      <View style={[f.body, { paddingTop: 22 }]}>
        <Text style={f.title}>{t('fuel.typeTitle')}</Text>
        {FUEL_TYPES.map((fuel: FuelType) => (
          <Pressable
            key={fuel}
            onPress={() => nav.navigate('FuelPicker', { fuelType: fuel })}
            accessibilityRole="button"
            style={s.option}
          >
            <View style={s.iconBox}>
              <Icon name="fuel" size={22} color={colors.brand} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={s.label}>{fuelLabel(t, fuel)}</Text>
              <Text style={s.sub}>{t(`fuel.${fuel}Sub`)}</Text>
            </View>
            <Text style={s.unit}>{unitLabel(t, fuel)}</Text>
            <Icon name="chevron-right" size={18} color={colors.slateLt} strokeWidth={2.4} />
          </Pressable>
        ))}
      </View>
    </FuelScreen>
  );
}

const s = StyleSheet.create({
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.mist,
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 20,
  },
  iconBox: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: colors.brandTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 20, fontWeight: '800', color: colors.ink },
  sub: { fontSize: 14, color: colors.slate, fontWeight: '600' },
  unit: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.slateLt,
    backgroundColor: colors.chip,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
});
