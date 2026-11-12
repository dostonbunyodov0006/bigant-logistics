import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors } from './theme';

/** As long as the server takes it (owner, 07.11.2026). */
export const END_CHECK_NOTE_MAX = 300;

/** "+30" is sent only with something written (owner, 07.11.2026). */
export function canSendNote(note: string): boolean {
  const n = note.trim();
  return n.length > 0 && n.length <= END_CHECK_NOTE_MAX;
}

/**
 * What "+30 daqiqa" opens on the end-of-day question (owner, 07.11.2026):
 * "Qanday ish bilan bandsiz?" and Yuborish, lit only once he has written it.
 */
export function EndCheckNote({
  note,
  onChange,
  onSend,
  pending,
  error,
}: {
  note: string;
  onChange: (v: string) => void;
  onSend: () => void;
  pending: boolean;
  error: string | null;
}) {
  const { t } = useTranslation();
  const ok = canSendNote(note) && !pending;
  return (
    <View style={s.wrap}>
      <Text style={s.label}>{t('shift.extendNoteLabel')}</Text>
      <TextInput
        style={s.input}
        value={note}
        onChangeText={onChange}
        placeholder={t('shift.extendNotePlaceholder')}
        placeholderTextColor={colors.slateLt}
        maxLength={END_CHECK_NOTE_MAX}
        multiline
        autoFocus
        accessibilityLabel={t('shift.extendNoteLabel')}
      />
      {error ? <Text style={s.error}>{error}</Text> : null}
      <Pressable
        onPress={onSend}
        disabled={!ok}
        accessibilityRole="button"
        accessibilityState={{ disabled: !ok }}
        style={[s.send, !ok && { opacity: 0.5 }]}
      >
        <Text style={s.sendText}>{t('shift.extendSend')}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 8 },
  label: { fontSize: 13, fontWeight: '700', color: colors.warnInk },
  input: {
    minHeight: 48,
    maxHeight: 120,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.warnBorder,
    backgroundColor: colors.white,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  error: { fontSize: 13, fontWeight: '600', color: colors.danger },
  send: { height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brand },
  sendText: { fontSize: 14, fontWeight: '800', color: colors.onAccent },
});
