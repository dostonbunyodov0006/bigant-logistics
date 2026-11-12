import { useEffect, useRef } from 'react';
import { type NativeScrollEvent, type NativeSyntheticEvent, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from './theme';

/**
 * A clock the thumb rolls: hours on the left, minutes on the right, the
 * chosen pair dark in the middle and its neighbours faded above and below.
 * Drawn in the screen itself, not in a dialog, so the form it belongs to
 * stays in view while the time is set.
 */
const ITEM_H = 56;
const VISIBLE = 3;
const PAD = (ITEM_H * (VISIBLE - 1)) / 2;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTE_STEP = 5;
const MINUTES = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);
const two = (n: number) => String(n).padStart(2, '0');

function Column({
  values,
  value,
  onChange,
}: {
  values: number[];
  value: number;
  onChange: (v: number) => void;
}) {
  const ref = useRef<ScrollView>(null);
  const index = Math.max(0, values.indexOf(value));
  // Roll to the value when it is set from outside (a quick "1 soat" chip),
  // not only when the thumb moves it.
  useEffect(() => {
    ref.current?.scrollTo({ y: index * ITEM_H, animated: false });
  }, [index]);
  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.min(values.length - 1, Math.max(0, Math.round(e.nativeEvent.contentOffset.y / ITEM_H)));
    if (values[i] !== value) onChange(values[i]!);
  };
  return (
    <ScrollView
      ref={ref}
      style={s.column}
      contentContainerStyle={{ paddingVertical: PAD }}
      showsVerticalScrollIndicator={false}
      snapToInterval={ITEM_H}
      decelerationRate="fast"
      onMomentumScrollEnd={settle}
      onScrollEndDrag={settle}
      nestedScrollEnabled
    >
      {values.map((v) => (
        <View key={v} style={s.item}>
          <Text style={[s.itemText, v === value && s.itemTextOn]}>{two(v)}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

/** `value` is "HH:MM"; minutes land on the nearest five. */
export function WheelClock({ value, onChange }: { value: string; onChange: (hhmm: string) => void }) {
  const [h, m] = value.split(':').map((x) => Number(x) || 0);
  const hour = Math.min(23, h ?? 0);
  const minute = Math.round((m ?? 0) / MINUTE_STEP) * MINUTE_STEP % 60;
  return (
    <View style={s.wheel}>
      <View pointerEvents="none" style={s.band} />
      <Column values={HOURS} value={hour} onChange={(v) => onChange(`${two(v)}:${two(minute)}`)} />
      <Text style={s.colon}>:</Text>
      <Column values={MINUTES} value={minute} onChange={(v) => onChange(`${two(hour)}:${two(v)}`)} />
    </View>
  );
}

const s = StyleSheet.create({
  wheel: {
    height: ITEM_H * VISIBLE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: colors.chip,
  },
  band: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: PAD,
    height: ITEM_H,
    borderRadius: 12,
    backgroundColor: colors.white,
  },
  column: { width: 96 },
  item: { height: ITEM_H, alignItems: 'center', justifyContent: 'center' },
  itemText: { fontSize: 28, fontWeight: '600', color: colors.slateLt },
  itemTextOn: { fontSize: 34, fontWeight: '800', color: colors.ink },
  colon: { fontSize: 30, fontWeight: '800', color: colors.ink, marginHorizontal: 6, marginTop: -4 },
});
