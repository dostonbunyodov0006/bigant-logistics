import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { colors, setThemeMode, themeMode, type ThemeMode } from './theme';

/**
 * Everything that is not the job: how the app looks, what it tells him, and
 * the way out.
 *
 * These used to sit along the top of the home screen next to the work
 * buttons, where a thumb reaching for the fuel log could sign the driver out.
 * One gear, and they live behind it.
 */
export function SettingsSheet({
  visible,
  onClose,
  unread,
  onNotifications,
}: {
  visible: boolean;
  onClose: () => void;
  unread: number;
  onNotifications: () => void;
  /** Only while he is on shift; absent when there is nothing to end. */
  pending?: boolean;
}) {
  const { t } = useTranslation();
  const { logout } = useAuth();
  // Sign-out is confirmed here, in the sheet's own colours, not in Android's
  // white box (owner, 07.11.2026). It folds back when the sheet closes.
  const [confirming, setConfirming] = useState(false);
  // The first tap does nothing; the second asks (owner, 07.11.2026). Both fold
  // back when the sheet closes.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!visible) {
      setConfirming(false);
      setArmed(false);
    }
  }, [visible]);

  const choose = (mode: ThemeMode) => {
    if (mode === themeMode) return;
    void setThemeMode(mode).then((reloaded) => {
      // The palette is fixed when the app starts, so the app restarts to take
      // it. If the updater is not there to do that — a development build —
      // say so rather than leave him tapping a switch that does nothing.
      if (!reloaded) Alert.alert(t('settings.restartNeeded'));
    });
  };

  const modes: { key: ThemeMode; label: string }[] = [
    { key: 'dark', label: t('settings.themeDark') },
    { key: 'light', label: t('settings.themeLight') },
  ];

  return (
    <Sheet visible={visible} onClose={onClose} title={t('settings.title')}>
      {/* Bildirishnomalar first, the look under it (owner, 07.11.2026). */}
      <Pressable
        onPress={() => {
          onClose();
          onNotifications();
        }}
        accessibilityRole="button"
        style={[s.row, s.rowFirst]}
      >
        <Icon name="bell" size={18} />
        <Text style={s.rowText}>{t('tabs.notifications')}</Text>
        {unread > 0 && (
          <View style={s.badge}>
            <Text style={s.badgeText}>{unread}</Text>
          </View>
        )}
        <Icon name="chevron-right" size={16} color={colors.slateLt} />
      </Pressable>

      {/* Only the two buttons: no "Ko'rinish" title, no "Hozir … rejim" line,
          no build line at the bottom (owner, 07.11.2026). */}
      <View style={[s.modes, s.modesBelow]}>
        {modes.map((m) => {
          const active = m.key === themeMode;
          return (
            <Pressable
              key={m.key}
              onPress={() => choose(m.key)}
              accessibilityRole="button"
              style={[s.mode, active && s.modeActive]}
            >
              <Text style={[s.modeText, active && s.modeTextActive]}>{m.label}</Text>
            </Pressable>
          );
        })}
      </View>



      {confirming ? (
        <View style={s.confirm}>
          <Text style={s.confirmText}>{t('profile.signOutConfirm')}</Text>
          <View style={s.confirmRow}>
            <Pressable
              onPress={() => {
                setConfirming(false);
                setArmed(false);
              }}
              accessibilityRole="button"
              style={[s.confirmBtn, s.confirmCancel]}
            >
              <Text style={s.confirmCancelText}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable onPress={logout} accessibilityRole="button" style={[s.confirmBtn, s.confirmGo]}>
              <Text style={s.confirmGoText}>{t('profile.signOut')}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          onPress={() => (armed ? setConfirming(true) : setArmed(true))}
          accessibilityRole="button"
          style={[s.row, s.signOut]}
        >
          <Text style={[s.rowText, s.signOutText]}>{t('profile.signOut')}</Text>
        </Pressable>
      )}
    </Sheet>
  );
}

const s = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '700', color: colors.slate, marginBottom: 8 },
  modes: { flexDirection: 'row', gap: 8 },
  modesBelow: { marginTop: 14 },
  rowFirst: { marginTop: 0 },
  mode: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.mist,
    backgroundColor: colors.white,
    paddingVertical: 12,
  },
  modeActive: { borderColor: colors.brand, backgroundColor: colors.brandTint },
  modeText: { fontSize: 14, fontWeight: '600', color: colors.slate },
  modeTextActive: { color: colors.brandDark, fontWeight: '800' },
  hint: { marginTop: 8, fontSize: 12, color: colors.slateLt },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.mist,
    backgroundColor: colors.white,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  rowText: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.ink },
  badge: {
    minWidth: 22,
    alignItems: 'center',
    borderRadius: 99,
    backgroundColor: colors.danger,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  badgeText: { fontSize: 12, fontWeight: '800', color: '#ffffff' },
  signOut: { borderColor: colors.danger, backgroundColor: colors.dangerBg },
  signOutText: { color: colors.danger, textAlign: 'center' },
  confirm: {
    marginTop: 14,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.danger,
    backgroundColor: colors.dangerBg,
    gap: 12,
  },
  confirmText: { fontSize: 15, fontWeight: '700', color: colors.ink, textAlign: 'center' },
  confirmRow: { flexDirection: 'row', gap: 10 },
  confirmBtn: { flex: 1, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  confirmCancel: { borderWidth: 1, borderColor: colors.mist, backgroundColor: colors.white },
  confirmCancelText: { fontSize: 15, fontWeight: '700', color: colors.ink },
  confirmGo: { backgroundColor: colors.danger },
  // Literal white: the theme's "white" is near-black on the dark set.
  confirmGoText: { fontSize: 15, fontWeight: '800', color: '#ffffff' },
  version: { marginTop: 14, textAlign: 'center', fontSize: 11, color: colors.slateLt },
});
