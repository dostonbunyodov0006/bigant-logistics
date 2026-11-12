export type SellerTheme = 'dark' | 'light';

const KEY = 'bigant.seller.theme';

/**
 * The board is dark unless the seller says otherwise.
 *
 * Deliberately not the system preference: this screen has been dark since the
 * day it shipped, and a phone set to light would otherwise repaint it under
 * someone who never asked.
 */
export function getSellerTheme(): SellerTheme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function setSellerTheme(theme: SellerTheme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Private browsing: the choice holds for this tab and is forgotten after.
  }
}
