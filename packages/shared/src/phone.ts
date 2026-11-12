import { z } from 'zod';

export const UZ_PHONE_PREFIX = '+998';
export const UZ_PHONE_NORMALIZED_LENGTH = 13;
export const UZ_PHONE_DISPLAY_LENGTH = 17;

/**
 * The two digits after +998 name the network, and only these exist: the
 * mobile operators' codes, and 61–79 for the landlines of Tashkent and the
 * regions (71 Toshkent, 66 Samarqand, 65 Buxoro…). A number that passes the
 * nine-digit test with any other pair — 12, 45, 00 — is a typo, and a driver
 * would be dialling it at the client's gate.
 */
export const UZ_PHONE_MOBILE_CODES = ['20', '33', '50', '55', '77', '88', '90', '91', '93', '94', '95', '97', '98', '99'] as const;

const UZ_PHONE_PATTERN = new RegExp(String.raw`^\+998(?:${UZ_PHONE_MOBILE_CODES.join('|')}|6[1-9]|7[0-9])\d{7}$`);

/**
 * The nine local digits of whatever was typed or pasted.
 *
 * The field starts with the country code already in it, so pasting a full
 * number on top of it leaves `+998+998 90 …`. Dropping one leading 998 is not
 * enough there — but dropping them until nine digits remain is, and it leaves
 * a real 99-series number (99 812 34 56, whose digits also begin 998) alone,
 * because stripping only continues while there is more than a number's worth
 * of digits left.
 */
function localDigits(value: string): string {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('998')) digits = digits.slice(3);
  while (digits.length > 9 && digits.startsWith('998')) digits = digits.slice(3);
  return digits.slice(0, 9);
}

/** Format a partially entered Uzbekistan phone number for display. */
export function formatUzPhoneNumber(value: string): string {
  const digits = localDigits(value);
  const groups = [
    digits.slice(0, 2),
    digits.slice(2, 5),
    digits.slice(5, 7),
    digits.slice(7, 9),
  ].filter(Boolean);

  return groups.length > 0 ? `${UZ_PHONE_PREFIX} ${groups.join(' ')}` : UZ_PHONE_PREFIX;
}

/**
 * Remove display separators while preserving the required Uzbekistan prefix.
 * Nine digits alone are a local number typed without +998 (the login and the
 * account forms no longer show it), and get the prefix.
 */
export function normalizeUzPhoneNumber(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 9) return `${UZ_PHONE_PREFIX}${digits}`;
  return digits.startsWith('998') ? `+${digits}` : value.trim();
}

/** The nine local digits grouped "90 123 45 67", without +998 — for the fields that leave it off. */
export function formatUzLocalPhone(value: string): string {
  const digits = localDigits(value);
  return [digits.slice(0, 2), digits.slice(2, 5), digits.slice(5, 7), digits.slice(7, 9)].filter(Boolean).join(' ');
}

/** "90 123 45 67" is twelve characters. */
export const UZ_PHONE_LOCAL_DISPLAY_LENGTH = 12;

export function isCompleteUzPhoneNumber(value: string): boolean {
  return UZ_PHONE_PATTERN.test(normalizeUzPhoneNumber(value));
}

/**
 * The number someone signs in with. Only its shape is checked — +998 and
 * nine digits — never the operator code: an account made before the code
 * rule, with a mistyped code, must still open, or its owner is locked out of
 * the very screen where the number could be corrected.
 */
export const uzPhoneLoginSchema = z
  .string()
  .transform(normalizeUzPhoneNumber)
  .refine((v) => /^\+998\d{9}$/.test(v), 'Phone number must contain 9 digits after +998');

/** Accepts formatted input and returns the 13-character normalized value. */
export const uzPhoneSchema = z
  .string()
  .transform(normalizeUzPhoneNumber)
  .refine(isCompleteUzPhoneNumber, 'Phone number must be +998, an operator code and seven digits');
