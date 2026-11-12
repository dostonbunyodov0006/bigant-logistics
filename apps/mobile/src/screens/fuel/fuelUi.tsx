import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useBottomInset } from '../../lib/useBottomInset';
import { Icon, type IconName } from '../../components/Icon';
import { colors } from '../../components/theme';

/**
 * The handful of pieces every fuel screen is built from, so the five screens
 * read as one flow: the primary button, its quieter sibling, the section
 * eyebrow and the card. Same radii and weights as the order screens.
 */

/** The screen root: paper ground, and clear of the phone's navigation bar at the bottom. */
export function FuelScreen({ children }: { children: React.ReactNode }) {
  const bottomInset = useBottomInset();
  return <View style={[f.screen, { paddingBottom: bottomInset }]}>{children}</View>;
}

export function PrimaryButton({
  label,
  icon,
  onPress,
  disabled,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={[f.primary, disabled && f.disabled]}
    >
      {icon ? <Icon name={icon} size={19} color={colors.onAccent} /> : null}
      <Text style={f.primaryText}>{label}</Text>
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  icon,
  onPress,
  style,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={[f.secondary, style]}>
      {icon ? <Icon name={icon} size={15} strokeWidth={2.2} /> : null}
      <Text style={f.secondaryText}>{label}</Text>
    </Pressable>
  );
}

export function Eyebrow({ children, tone = 'slate' }: { children: string; tone?: 'slate' | 'brand' }) {
  return <Text style={[f.eyebrow, tone === 'brand' && { color: colors.brand }]}>{children}</Text>;
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[f.card, style]}>{children}</View>;
}

/** The Yaqinimda · Ro'yxat · Ko'cha row, in the same pill style as the home tabs. */
export function Segmented<K extends string>({
  value,
  onChange,
  items,
}: {
  value: K;
  onChange: (k: K) => void;
  items: { key: K; label: string; icon: IconName }[];
}) {
  return (
    <View style={f.seg}>
      {items.map((it) => {
        const on = it.key === value;
        return (
          <Pressable
            key={it.key}
            onPress={() => onChange(it.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[f.segBtn, on && f.segOn]}
          >
            <Icon name={it.icon} size={15} strokeWidth={2.2} color={on ? colors.brand : colors.slate} />
            <Text style={[f.segLabel, on && f.segLabelOn]}>{it.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export const f = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  body: { padding: 16, gap: 12, flexGrow: 1 },
  spacer: { flex: 1 },
  title: { fontSize: 26, fontWeight: '800', color: colors.ink, letterSpacing: -0.3 },
  hint: { fontSize: 14, color: colors.slate, lineHeight: 20 },
  primary: {
    height: 56,
    borderRadius: 16,
    backgroundColor: colors.brand,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryText: { fontSize: 18, fontWeight: '800', color: colors.onAccent },
  disabled: { opacity: 0.5 },
  secondary: {
    flex: 1,
    height: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.mist,
    backgroundColor: colors.white,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondaryText: { fontSize: 16, fontWeight: '700', color: colors.ink },
  row: { flexDirection: 'row', gap: 10 },
  eyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 0.7, color: colors.slate },
  card: { backgroundColor: colors.white, borderRadius: 16, padding: 16 },
  seg: { flexDirection: 'row', gap: 6 },
  segBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    backgroundColor: colors.chip,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  segOn: { backgroundColor: colors.white, borderColor: colors.brand },
  segLabel: { fontSize: 13, fontWeight: '600', color: colors.slate },
  segLabelOn: { fontWeight: '700', color: colors.brand },
  note: {
    backgroundColor: colors.brandTint,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    lineHeight: 18,
    color: colors.brandDark,
  },
});
