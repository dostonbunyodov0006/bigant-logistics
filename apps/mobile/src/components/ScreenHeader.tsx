import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Icon } from './Icon';
import { colors } from './theme';

/**
 * The header of every pushed screen: back arrow, title, the status bar
 * cleared above it.
 *
 * The app draws edge to edge on Android, and the native stack header was
 * handling the status-bar inset differently from the home screen — the
 * title ended up under the clock, and the bottom of the page under the
 * navigation bar picked up a stray white band. Drawing the header ourselves,
 * inside the same safe-area handling the home screen uses, makes every
 * screen behave the same way at both edges.
 */
export function ScreenHeader({
  title,
  back = true,
  right,
  onBack,
}: {
  title: string;
  /** Replaces going back a screen — for a screen that walks its own steps. */
  onBack?: () => void;
  /** False on a screen there is no going back from, such as a receipt. */
  back?: boolean;
  right?: ReactNode;
}) {
  const { t } = useTranslation();
  const nav = useNavigation();
  return (
    <SafeAreaView edges={['top']} style={s.safe}>
      <View style={s.row}>
        {back ? (
          <Pressable
            onPress={onBack ?? (() => nav.goBack())}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            hitSlop={8}
            style={s.back}
          >
            <Icon name="chevron-left" size={24} color={colors.ink} strokeWidth={2.2} />
          </Pressable>
        ) : (
          <View style={s.backSpacer} />
        )}
        <Text style={s.title} numberOfLines={1}>
          {title}
        </Text>
        {right ?? null}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.mist },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 8, gap: 4 },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backSpacer: { width: 8 },
  title: { flex: 1, fontSize: 17, fontWeight: '800', color: colors.ink },
});
