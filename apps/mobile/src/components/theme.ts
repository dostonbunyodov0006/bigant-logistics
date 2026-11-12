import { Appearance } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Two palettes, one name for each colour.
 *
 * A driver works in a cab at midday and in a yard at midnight, so the app has
 * a dark set as well as a light one. Which set is in use is decided once, at
 * start-up: every StyleSheet in the app is built when its module is first
 * imported, and a style sheet cannot be rebuilt afterwards. Switching
 * therefore writes the choice down and reloads the app, which takes under a
 * second and leaves him on the same screen.
 *
 * The names mean the same thing in both sets — `ink` is the text, `paper` is
 * what it is written on — so nothing in the app needs to know which is in use.
 */
const LIGHT = {
  ink: '#14181f',
  graphite: '#3b4049',
  slate: '#5b6470',
  slateLt: '#8a93a0',
  mist: '#d9dce1',
  paper: '#f5f6f7',
  white: '#ffffff',
  // Text and icons laid on a coloured fill (a button, a badge): white in
  // both sets. `white` is the card colour and goes near-black on dark.
  onAccent: '#ffffff',
  brand: '#E2630B',
  brandDark: '#b94e06',
  brandTint: '#fdf0e6',
  danger: '#dc2626',
  dangerBg: '#fdeaea',
  dangerInk: '#b91c1c',
  dangerBorder: '#fca5a5',
  success: '#15803d',
  successBg: '#e6f6ec',
  // The neutral pill behind an order number or a tag.
  chip: '#eef0f2',
  // The amber family: a warning that is not yet a failure.
  warn: '#b45309',
  warnSoft: '#9a5b06',
  warnBg: '#fdeede',
  warnInk: '#7c2d12',
  warnBorder: '#f59e0b',
  // What sits under a photo while it loads.
  photoBg: '#e6e8eb',
} as const;

/**
 * The dark set, built by turning the light one over rather than by picking
 * new colours: text becomes near-white, the page becomes near-black, a card
 * sits a clear step above the page, and the tints that carry a message —
 * brand, danger, success — are translucent washes rather than hand-mixed
 * browns, so they keep their hue on whatever they land on.
 *
 * The brand orange is lifted a little here (#ff7a1a against #E2630B): the
 * darker orange of the light set goes brown against a near-black page, which
 * is most of what made the dark app look drab.
 */
const DARK = {
  // Brighter than before: the secondary greys were hard to read for a driver
  // whose eyes are not what they were. Text is white, and even the quietest
  // label sits well above the page.
  ink: '#ffffff',
  graphite: '#ffffff',
  // Labels and second lines: near-white, not grey. On a phone in the sun or
  // for weaker eyes a grey label read as no label at all.
  slate: '#e6ebf2',
  slateLt: '#cfd6e0',
  mist: '#4a5568',
  paper: '#0d1118',
  white: '#171d27',
  onAccent: '#ffffff',
  brand: '#ff7a1a',
  brandDark: '#ff9449',
  // The washes are laid over whatever is beneath them rather than mixed by
  // hand. A hand-mixed dark brown went muddy on a card and invisible on the
  // page; a translucent one keeps the hue and picks up its own surface.
  brandTint: 'rgba(255, 122, 26, 0.16)',
  danger: '#ff8080',
  dangerBg: 'rgba(255, 128, 128, 0.16)',
  dangerInk: '#ff8080',
  dangerBorder: 'rgba(255, 128, 128, 0.45)',
  success: '#5fe08f',
  successBg: 'rgba(95, 224, 143, 0.15)',
  chip: 'rgba(255, 255, 255, 0.12)',
  warn: '#fbbf24',
  warnSoft: '#e5b65f',
  warnBg: 'rgba(251, 191, 36, 0.16)',
  warnInk: '#fcd34d',
  warnBorder: 'rgba(251, 191, 36, 0.45)',
  photoBg: '#242b36',
} as const;

export type ThemeMode = 'light' | 'dark' | 'system';
const THEME_KEY = 'bigant.theme';

/** What was chosen last, read before the first style sheet is built. */
function storedMode(): ThemeMode {
  try {
    const raw = SecureStore.getItem(THEME_KEY);
    // Nothing chosen yet: dark. A cab at night is where the app lives, and
    // the dark set is the one the drivers took to.
    return raw === 'light' ? 'light' : 'dark';
  } catch {
    // A locked keystore is not a reason to fail to start.
    return 'dark';
  }
}

export const themeMode: ThemeMode = storedMode();
export const isDarkTheme =
  themeMode === 'dark' || (themeMode === 'system' && Appearance.getColorScheme() === 'dark');

export const colors = isDarkTheme ? DARK : LIGHT;

/**
 * Remember the choice and start the app again on it.
 *
 * The reload is what makes the new palette take: style sheets are frozen at
 * import. Without the updater available — a development build — the caller is
 * told to reopen the app by hand.
 */
export async function setThemeMode(mode: ThemeMode): Promise<boolean> {
  try {
    await SecureStore.setItemAsync(THEME_KEY, mode);
  } catch {
    return false;
  }
  try {
    const Updates = await import('expo-updates');
    await Updates.reloadAsync();
    return true;
  } catch {
    return false;
  }
}

// Status tones keyed by OrderStatus / DriverStatus.
export const ORDER_STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  created: { bg: '#eef1f5', fg: '#5b6470' },
  assigned_to_driver: { bg: '#e7effe', fg: '#1d4ed8' },
  driver_accepted: { bg: '#e3f0ff', fg: '#2563eb' },
  collecting_items: { bg: '#fdf0e6', fg: '#b94e06' },
  items_collected: { bg: '#fef6e7', fg: '#a15c07' },
  on_the_way: { bg: '#efe9fe', fg: '#6d28d9' },
  arrived_at_customer: { bg: '#e8e2fb', fg: '#5b21b6' },
  delivered: { bg: '#e6f6ec', fg: '#15803d' },
  returning: { bg: '#fdeede', fg: '#b45309' },
  returned: { bg: '#eceff3', fg: '#64748b' },
  cancelled: { bg: '#f0f1f3', fg: '#8a93a0' },
  problem: { bg: '#fdeaea', fg: '#dc2626' },
};

