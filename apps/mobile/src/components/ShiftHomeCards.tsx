import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon } from './Icon';
import { EndCheckNote, canSendNote } from './EndCheckNote';
import { colors } from './theme';
import { useShiftContext } from './ShiftProvider';

/**
 * What the home screen says about the shift itself, above the orders: the
 * end-of-day question while it is waiting for his answer, and — the morning
 * after — that yesterday's shift was closed for him.
 */
export function ShiftHomeCards() {
  return (
    <>
      <EndCheckCard />
    </>
  );
}

/** "Ish kuningiz tugadimi?" — shown while a reminder waits for his answer. */
function EndCheckCard() {
  const shift = useShiftContext();
  if (!shift.onShift || !shift.endCheck?.awaiting_answer) return null;
  // A fresh note box for each ask.
  return <EndCheckCardBody key={shift.endCheck.asked_at ?? ''} />;
}

function EndCheckCardBody() {
  const { t } = useTranslation();
  const shift = useShiftContext();
  // "+30 daqiqa" opens the note first; Yuborish sends it (owner, 07.11.2026).
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState('');
  const end = shift.endCheck?.shift_end;
  return (
    <View style={s.slot}>
      <View style={s.check}>
        <View style={s.checkHead}>
          <View style={s.checkIcon}>
            <Icon name="clock" size={18} color={colors.warn} strokeWidth={2.2} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={s.checkTitle}>{t('shift.checkTitle')}</Text>
            <Text style={s.checkBody}>
              {end ? t('shift.checkBody', { end }) : t('shift.checkBodyNoEnd')}
            </Text>
          </View>
        </View>
        <View style={s.checkRow}>
          <Pressable
            onPress={() => setNoting(true)}
            disabled={shift.pending}
            accessibilityRole="button"
            style={[s.checkBtn, s.checkBtnQuiet, noting && s.checkBtnQuietOn]}
          >
            <Text style={s.checkBtnQuietText}>{t('shift.extend')}</Text>
          </Pressable>
          <Pressable
            onPress={shift.stop}
            disabled={shift.pending}
            accessibilityRole="button"
            style={[s.checkBtn, s.checkBtnLoud, shift.pending && { opacity: 0.5 }]}
          >
            <Text style={s.checkBtnLoudText}>{t('shift.stop')}</Text>
          </Pressable>
        </View>
        {noting && (
          <EndCheckNote
            note={note}
            onChange={setNote}
            onSend={() => {
              if (canSendNote(note)) shift.extend(note);
            }}
            pending={shift.pending}
            error={shift.extendError}
          />
        )}
      </View>
    </View>
  );
}


const s = StyleSheet.create({
  // Each card brings its own spacing, so a hidden card leaves no gap.
  slot: { paddingHorizontal: 16, paddingTop: 12 },
  check: {
    backgroundColor: colors.warnBg,
    borderWidth: 1,
    borderColor: colors.warnBorder,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  checkHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  checkIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkTitle: { fontSize: 16, fontWeight: '800', color: colors.warnInk },
  checkBody: { fontSize: 13, color: colors.warnSoft, lineHeight: 18 },
  checkRow: { flexDirection: 'row', gap: 8 },
  checkBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBtnQuiet: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.warnBorder },
  checkBtnQuietOn: { borderColor: colors.warn, borderWidth: 1.5 },
  checkBtnQuietText: { fontSize: 14, fontWeight: '800', color: colors.warnInk },
  checkBtnLoud: { backgroundColor: colors.brand },
  checkBtnLoudText: { fontSize: 14, fontWeight: '800', color: colors.onAccent },
  auto: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.mist,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  autoTitle: { fontSize: 15, fontWeight: '800', color: colors.ink },
  autoBody: { fontSize: 13, color: colors.slate, lineHeight: 18 },
  autoFacts: {
    backgroundColor: colors.paper,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  autoFactLabel: { fontSize: 14.5, color: colors.slate, fontWeight: '600' },
  autoFactValue: { fontSize: 13.5, fontWeight: '700', color: colors.ink },
  autoFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  autoFix: { flex: 1, fontSize: 12.5, color: colors.slateLt },
  gotIt: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.mist,
    justifyContent: 'center',
  },
  gotItText: { fontSize: 13, fontWeight: '700', color: colors.graphite },
  startHint: { fontSize: 13, color: colors.slate, textAlign: 'center', lineHeight: 19 },
});
