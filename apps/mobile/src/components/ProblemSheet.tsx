import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ORDER_EXCEPTION_REASONS, type OrderExceptionReason } from '@bigant/shared';
import { Sheet } from './Sheet';
import { Icon } from './Icon';
import { colors } from './theme';

/**
 * "Muammo bormi?" — what used to be two coloured full-width buttons sitting
 * beside the deliver button.
 *
 * Istisno and Vozrat do very different things (one still hands the cargo over,
 * the other closes the order and starts a journey back) and the old screen said
 * so nowhere. Here each carries the sentence that distinguishes them, and
 * neither can be hit by mis-aiming at the green button.
 */
export function ProblemSheet({
  visible,
  onClose,
  clientName,
  pending,
  alreadyReported,
  onSubmitException,
  onChooseReturn,
  exceptionOnly = false,
}: {
  visible: boolean;
  onClose: () => void;
  orderNumber: number;
  clientName: string;
  pending: boolean;
  alreadyReported: boolean;
  onSubmitException: (reason: OrderExceptionReason, comment: string | null) => void;
  onChooseReturn: () => void;
  /** Straight to the reasons: the Istisno button on the order card opens the
   *  form itself, with no "exception or return?" question in front of it. */
  exceptionOnly?: boolean;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'choose' | 'exception'>(exceptionOnly ? 'exception' : 'choose');
  const [reason, setReason] = useState<OrderExceptionReason | null>(null);
  const [comment, setComment] = useState('');

  const close = () => {
    setMode(exceptionOnly ? 'exception' : 'choose');
    setReason(null);
    setComment('');
    onClose();
  };

  const submit = () => {
    if (!reason) {
      Alert.alert(t('common.completeRequiredFields'));
      return;
    }
    onSubmitException(reason, comment.trim() || null);
  };

  if (mode === 'exception') {
    return (
      <Sheet
        visible={visible}
        onClose={close}
        title={t('home.exceptionTitle')}
        subtitle={t('home.clientNamed', { name: clientName })}
      >
        <View style={s.chipWrap}>
          {ORDER_EXCEPTION_REASONS.map((item) => {
            const active = reason === item;
            return (
              <Pressable
                key={item}
                onPress={() => setReason(item)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                style={[s.chip, active && s.chipOn]}
              >
                <Text style={[s.chipText, active && s.chipTextOn]}>
                  {t(`exceptionReason.${item}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <TextInput
          style={s.input}
          value={comment}
          onChangeText={setComment}
          placeholder={t('home.exceptionCommentOptional')}
          placeholderTextColor={colors.slateLt}
          multiline
          maxLength={500}
        />

        <Pressable
          onPress={submit}
          disabled={pending}
          accessibilityRole="button"
          style={[s.primary, pending && s.dim]}
        >
          <Text style={s.primaryText}>{t('home.submit')}</Text>
        </Pressable>

        <Pressable onPress={exceptionOnly ? close : () => setMode('choose')} style={s.cancel} accessibilityRole="button">
          <Text style={s.cancelText}>{exceptionOnly ? t('common.cancel') : t('common.back')}</Text>
        </Pressable>
      </Sheet>
    );
  }

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title={t('problem.title')}
      subtitle={t('home.clientNamed', { name: clientName })}
    >
      <Pressable
        onPress={() => setMode('exception')}
        disabled={alreadyReported}
        accessibilityRole="button"
        accessibilityState={{ disabled: alreadyReported }}
        style={[s.option, alreadyReported && s.dim]}
      >
        <View style={[s.optionMark, s.markWarn]}>
          <Icon name="warning" size={17} color="#854d0e" strokeWidth={2.2} />
        </View>
        <View style={s.optionBody}>
          <Text style={s.optionTitle}>{t('home.exception')}</Text>
          <Text style={s.optionDesc}>
            {alreadyReported ? t('home.exceptionAlreadyReported') : t('problem.exceptionDesc')}
          </Text>
        </View>
      </Pressable>

      <Pressable onPress={onChooseReturn} accessibilityRole="button" style={s.option}>
        <View style={[s.optionMark, s.markDanger]}>
          <Icon name="return" size={17} color={colors.dangerInk} strokeWidth={2.2} />
        </View>
        <View style={s.optionBody}>
          <Text style={s.optionTitle}>{t('home.returnCargo')}</Text>
          <Text style={s.optionDesc}>{t('problem.returnDesc')}</Text>
        </View>
      </Pressable>

      <View style={s.note}>
        <Text style={s.noteText}>{t('problem.note')}</Text>
      </View>

      <Pressable onPress={close} style={s.cancel} accessibilityRole="button">
        <Text style={s.cancelText}>{t('common.cancel')}</Text>
      </Pressable>
    </Sheet>
  );
}

const s = StyleSheet.create({
  dim: { opacity: 0.55 },
  option: {
    flexDirection: 'row',
    gap: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.mist,
    backgroundColor: colors.white,
    padding: 14,
  },
  optionMark: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markWarn: { backgroundColor: '#fefce8', borderColor: '#eab308' },
  markDanger: { backgroundColor: colors.dangerBg, borderColor: colors.danger },
  optionBody: { flex: 1 },
  optionTitle: { fontSize: 16, fontWeight: '800', color: colors.ink },
  optionDesc: { marginTop: 3, fontSize: 13, fontWeight: '600', color: colors.slate, lineHeight: 18 },
  note: { borderRadius: 12, backgroundColor: colors.paper, paddingHorizontal: 13, paddingVertical: 11 },
  noteText: { fontSize: 12, fontWeight: '600', color: colors.slate, lineHeight: 17 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.mist,
    paddingHorizontal: 12,
    paddingVertical: 10,
    width: '48%',
    alignItems: 'center',
  },
  chipOn: { borderColor: colors.brand, backgroundColor: colors.brandTint },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.slate },
  chipTextOn: { color: colors.brandDark },
  input: {
    minHeight: 80,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.mist,
    padding: 12,
    fontSize: 15,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  primary: {
    height: 56,
    borderRadius: 12,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { fontSize: 17, fontWeight: '800', color: colors.onAccent },
  cancel: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 12 },
  cancelText: { fontSize: 14, fontWeight: '700', color: colors.slate },
});
