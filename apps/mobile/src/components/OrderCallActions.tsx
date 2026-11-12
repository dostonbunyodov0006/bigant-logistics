import { Linking, Pressable, StyleSheet, Text } from 'react-native';
import { Icon } from './Icon';
import { colors } from './theme';

function dialablePhone(phone: string | null | undefined): string | null {
  const normalized = phone?.trim().replace(/[^\d+]/g, '') ?? '';
  return /\d/.test(normalized) ? normalized : null;
}

/** `disabled`: another order is under way; this one can be read, not called. */
export function PhoneCallButton({ phone, label, disabled = false }: { phone: string | null | undefined; label: string; disabled?: boolean }) {
  const dialable = dialablePhone(phone);
  if (!dialable) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => void Linking.openURL(`tel:${dialable}`)}
      style={({ pressed }) => [s.button, pressed && s.pressed, disabled && { opacity: 0.35 }]}
    >
      <Icon name="phone" size={15} color={colors.graphite} strokeWidth={2.2} />
      <Text style={s.buttonText} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}


// Two calls share one row as equal halves and never wrap: the row is the
// same height whether one number or two is known, and the labels are short
// on purpose ("Sotuvchiga", not "Sotuvchiga qo'ng'iroq") so both fit at any
// phone width. Neutral rather than green — a call is a means, not a status.
const s = StyleSheet.create({
  button: {
    flex: 1,
    height: 44,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1,
    borderColor: colors.mist,
    borderRadius: 12,
    backgroundColor: colors.white,
    paddingHorizontal: 12,
  },
  pressed: { opacity: 0.65 },
  buttonText: { fontSize: 14, fontWeight: '700', color: colors.ink },
});
