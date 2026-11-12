/**
 * Names as they are stored: every word starts with a capital, the rest of it
 * lower case.
 *
 * Typed names arrive in whatever state the keyboard was in — "akmal aka",
 * "AKMAL AKA", "aKmal" — and a list of those reads as carelessness even when
 * the work behind it is careful. The name is tidied where it is saved rather
 * than where it is shown, so every screen, report and Telegram message agrees.
 *
 * Only names of people and places go through this: a plate number, a product
 * from the catalogue, an address or anything somebody wrote in sentences keeps
 * the shape it was given.
 */
export function titleCase(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    // One word, one capital. Working inside the word rather than on every run
    // of letters keeps "do'kon" and "3-uy" whole: an apostrophe or a hyphen is
    // part of the word, not the start of a new one.
    .map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1).toLocaleLowerCase())
    .join(' ');
}
