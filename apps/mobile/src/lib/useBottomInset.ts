import { Dimensions, Platform, StatusBar, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * How far the bottom of a screen has to stay clear of the phone's own
 * navigation bar.
 *
 * The app is drawn edge to edge, under that bar. On Android 15 the system
 * under-reports the bar — 0, or a sliver — while it is sitting on top of the
 * app, a known gap in the inset bridge, and then every pinned bar and sheet
 * ends up half hidden behind the three buttons. So on Android three answers
 * are taken and the largest wins: what the inset bridge says, what the gap
 * between the full screen and the app's window says, and the 48dp a
 * three-button bar is. A phone with a slimmer bar loses a little blank
 * space, which is far cheaper than a driver who cannot reach "Yo'l ko'rsatish".
 */
const ANDROID_NAV_BAR = 48;
/** A little air between a button and the buttons of the phone. */
const ANDROID_EXTRA_LIFT = 12;

export function useBottomInset(): number {
  const { bottom } = useSafeAreaInsets();
  const win = useWindowDimensions();
  const screen = Dimensions.get('screen');
  const gap = Math.max(0, Math.round(screen.height - win.height - (StatusBar.currentHeight ?? 0)));
  return Platform.OS === 'android' ? Math.max(bottom, gap, ANDROID_NAV_BAR) + ANDROID_EXTRA_LIFT : bottom;
}
