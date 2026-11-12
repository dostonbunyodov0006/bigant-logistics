import { useEffect, useRef } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomInset } from '../lib/useBottomInset';
import { useKeyboardHeight } from '../lib/useKeyboardHeight';
import { colors } from './theme';

/**
 * The bottom sheet every decision step uses: proof photos, the problem chooser,
 * the return destinations.
 *
 * It is a sheet rather than more card: the card behind it keeps its size and
 * place, so the driver never loses where they were, and the thing being asked
 * sits at the bottom of the screen where the thumb already is.
 */
export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  badge,
  children,
  fullScreen = false,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  /** The whole screen instead of a sheet at its foot: for a form with a
   *  text box, so the keyboard never covers what is being typed. Closed by
   *  the ✕ in its head, there being no dimmed area to tap. */
  fullScreen?: boolean;
}) {
  // The sheet is the bottom-most thing on screen; its padding grows to clear
  // the phone's navigation bar so the confirm button is never under it.
  const bottomInset = useBottomInset();
  // With the keyboard up the whole sheet rises above it, so the box being
  // typed into — and the Save under it — stay in view.
  const keyboard = useKeyboardHeight();
  const insets = useSafeAreaInsets();
  // When the keyboard comes up it is for the box at the foot of the form, so
  // the body scrolls there by itself; the driver sees what he types and the
  // Save under it, not the top of a form he has already filled.
  const body = useRef<ScrollView>(null);
  useEffect(() => {
    if (keyboard > 0) {
      const id = setTimeout(() => body.current?.scrollToEnd({ animated: true }), 60);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [keyboard]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[s.overlay, fullScreen && s.overlayFull]}>
        {/* Tapping the dimmed area closes, as every sheet on the platform does. */}
        {!fullScreen && <Pressable style={s.scrim} onPress={onClose} accessibilityRole="button" />}
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={fullScreen && s.full}>
          <View
            style={[
              s.sheet,
              fullScreen && [s.sheetFull, { paddingTop: insets.top + 12 }],
              { paddingBottom: keyboard > 0 ? keyboard + 12 : Math.max(bottomInset, 18) },
            ]}
          >
            {!fullScreen && <View style={s.grabber} />}
            <View style={s.head}>
              <Text style={s.title}>{title}</Text>
              {badge}
              {fullScreen && (
                <Pressable onPress={onClose} accessibilityRole="button" hitSlop={10} style={s.close}>
                  <Text style={s.closeText}>✕</Text>
                </Pressable>
              )}
            </View>
            {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
            <ScrollView
              ref={body}
              // Shorter while the keyboard is up, so the sheet still fits above it
              // and the box being typed into scrolls into view.
              // Full screen, the body is the screen: no ceiling, so the reason box
              // at the foot of the form is reached by scrolling, not cut off.
              style={[s.body, fullScreen ? [s.full, { maxHeight: undefined }] : keyboard > 0 && { maxHeight: 260 }]}
              contentContainerStyle={[s.bodyContent, fullScreen && s.full]}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

/** "SURAT MAJBURIY" — the proof rule, stated before the driver acts on it. */
export function PhotoRequiredBadge({ label }: { label: string }) {
  return (
    <View style={s.badge}>
      <Text style={s.badgeText}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20,24,31,0.55)' },
  overlayFull: { backgroundColor: colors.white },
  full: { flex: 1, flexGrow: 1 },
  sheetFull: { flex: 1, borderTopLeftRadius: 0, borderTopRightRadius: 0 },
  close: { marginLeft: 'auto', width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.chip },
  closeText: { fontSize: 16, fontWeight: '700', color: colors.ink },
  scrim: { ...StyleSheet.absoluteFillObject },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 18,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 99,
    backgroundColor: colors.mist,
  },
  head: { marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 19, fontWeight: '800', color: colors.ink },
  subtitle: { marginTop: 4, fontSize: 13, fontWeight: '600', color: colors.slate, lineHeight: 18 },
  // Capped so a sheet with several cargo rows scrolls instead of running off
  // the top of the screen.
  body: { marginTop: 12, maxHeight: 460 },
  bodyContent: { gap: 12, paddingBottom: 2 },
  badge: {
    borderRadius: 99,
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: colors.danger,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3, color: colors.danger },
});
