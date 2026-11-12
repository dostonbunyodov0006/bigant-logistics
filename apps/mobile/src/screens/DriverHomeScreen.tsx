import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { DriverHeader } from '../components/DriverHeader';
import { ShiftProvider } from '../components/ShiftProvider';
import { OrderList } from '../components/OrderList';
import { CurrentOrdersTab, useCurrentOrder } from './tabs/CurrentOrdersTab';
import { OrderActionBar } from '../components/OrderActionBar';
import { TodayOrdersTab } from './tabs/TodayOrdersTab';
import { MyInfoTab } from './tabs/MyInfoTab';
import { queryClient } from '../lib/queryClient';
import { addDays, tashkentDayKey } from '../lib/format';
import { colors } from '../components/theme';

const TABS = ['current', 'today', 'tomorrow', 'info'] as const;
type Tab = (typeof TABS)[number];
const SCREEN_WIDTH = Dimensions.get('window').width;


/** The whole driver app: a persistent header + one row of 4 tab pills (Hozirgi /
 *  Bugungi / Ertangi / Ma'lumot) over a swipe pager, matching the prototype.
 *  The labels stay short on purpose — four equal quarters of a 390px row. */
export function DriverHomeScreen() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('current');
  const pagerRef = useRef<ScrollView>(null);
  const [pagerHeight, setPagerHeight] = useState(0);
  const current = useCurrentOrder();

  // Bugungi / Ertangi are Tashkent's days, not the phone's (owner, 06.11.2026).
  // Read again when the app comes back to the front and each minute (audit,
  // 07.11.2026): kept in memory overnight, the screen showed yesterday as Bugungi.
  const [day, setDay] = useState(() => tashkentDayKey());
  useEffect(() => {
    const look = () => setDay((d) => (tashkentDayKey() === d ? d : tashkentDayKey()));
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') look();
    });
    const id = setInterval(look, 60_000);
    return () => {
      sub.remove();
      clearInterval(id);
    };
  }, []);
  const { today, tomorrow } = useMemo(() => ({ today: day, tomorrow: addDays(day, 1) }), [day]);

  // Refresh orders + driver status whenever the app returns to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void queryClient.invalidateQueries({ queryKey: ['orders'] });
        void queryClient.invalidateQueries({ queryKey: ['order'] });
        void queryClient.invalidateQueries({ queryKey: ['driver', 'me'] });
      }
    });
    return () => sub.remove();
  }, []);

  const labels: Record<Tab, string> = {
    current: t('home.tabCurrent'),
    today: t('home.tabToday'),
    tomorrow: t('home.tabTomorrow'),
    info: t('home.tabInfo'),
  };

  const handleTabPress = useCallback((key: Tab) => {
    setTab(key);
    pagerRef.current?.scrollTo({ x: TABS.indexOf(key) * SCREEN_WIDTH, animated: true });
  }, []);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = TABS[Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH)];
    if (next) setTab(next);
  }, []);

  return (
    <ShiftProvider>
    <SafeAreaView style={s.safe} edges={['top']}>
      <DriverHeader />

      <View style={s.tabs}>
        {TABS.map((key) => (
          <Pressable
            key={key}
            onPress={() => handleTabPress(key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === key }}
            // The pill is ~33px tall by design; the slop brings the tappable
            // area to the 44px a thumb needs in a moving cab.
            hitSlop={{ top: 6, bottom: 6 }}
            style={[s.tabBtn, tab === key && s.tabActive]}
          >
            <Text numberOfLines={1} style={[s.tabLabel, tab === key && s.tabLabelActive]}>
              {labels[key]}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScroll}
        scrollEventThrottle={16}
        style={s.pager}
        // Each page is given the pager's measured height. Left to the row
        // layout, a page grows to its content, and a pinned bar at its foot
        // ends up below the bottom of the screen.
        onLayout={(e) => setPagerHeight(e.nativeEvent.layout.height)}
      >
        <View style={[s.page, pagerHeight > 0 && { height: pagerHeight }]}>
          <CurrentOrdersTab />
        </View>
        <View style={[s.page, pagerHeight > 0 && { height: pagerHeight }]}>
          <TodayOrdersTab date={today} />
        </View>
        <View style={[s.page, pagerHeight > 0 && { height: pagerHeight }]}>
          <OrderList
            queryKey={['orders', 'tomorrow', tomorrow]}
            url={`/orders?delivery_date=${tomorrow}`}
            emptyTitle={t('home.noTomorrow')}
          />
        </View>
        <View style={[s.page, pagerHeight > 0 && { height: pagerHeight }]}>
          <MyInfoTab />
        </View>
      </ScrollView>

      {/* The pinned bar lives here, in the screen's column, not inside the
          Hozirgi page: the screen ends where the phone's screen ends, and
          holds the bar above its foot whatever the page does. */}
      {tab === 'current' && current ? <OrderActionBar order={current} /> : null}
    </SafeAreaView>
    </ShiftProvider>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  tabs: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.mist,
  },
  tabBtn: {
    // Equal quarters of the row, so the four read as one control rather than a
    // ragged wrapped list.
    flex: 1,
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: colors.chip,
    paddingHorizontal: 4,
    paddingVertical: 8,
    // A transparent border on the inactive pills: the active one's border is
    // drawn inside the box, so without this the label jumps by a pixel on tap.
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tabActive: { backgroundColor: colors.white, borderColor: colors.brand },
  tabLabel: { fontSize: 12, fontWeight: '600', color: colors.slate },
  tabLabelActive: { fontWeight: '700', color: colors.brand },
  pager: { flex: 1 },
  page: { width: SCREEN_WIDTH },
});
