import { formatUzLocalPhone, formatUzPhoneNumber, normalizeUzPhoneNumber, uzPhoneLoginSchema, uzPhoneSchema } from '@bigant/shared';

/**
 * The login field arrives with "+998" already in it. Someone given a number to
 * sign in with pastes the whole thing on top of that, and before this was
 * handled the form quietly turned +998900000004 into +998 99 890 00 00 and
 * said the password was wrong.
 */
describe('Uzbekistan phone input', () => {
  it('formats the nine local digits as they are typed', () => {
    expect(formatUzPhoneNumber('')).toBe('+998');
    expect(formatUzPhoneNumber('+998 9')).toBe('+998 9');
    expect(formatUzPhoneNumber('+998 90')).toBe('+998 90');
    expect(formatUzPhoneNumber('+998 90000')).toBe('+998 90 000');
    expect(formatUzPhoneNumber('+998900000004')).toBe('+998 90 000 00 04');
  });

  it('a full number pasted onto the prefix is still that number', () => {
    expect(formatUzPhoneNumber('+998+998900000004')).toBe('+998 90 000 00 04');
    // A paste the field's length limit cut short still reads as the digits
    // that survived, rather than as a different number entirely.
    expect(formatUzPhoneNumber('+998+99890000000')).toBe('+998 90 000 00 0');
    expect(formatUzPhoneNumber('+998 +998 90 000 00 04')).toBe('+998 90 000 00 04');
  });

  it('leaves a 99-series number alone, whose own digits begin 998', () => {
    // 99 812 34 56 — the local digits really are 998123456.
    expect(formatUzPhoneNumber('+998998123456')).toBe('+998 99 812 34 56');
    expect(formatUzPhoneNumber('+998 99 812 34 56')).toBe('+998 99 812 34 56');
    // And the boss's own number survives the round trip.
    expect(formatUzPhoneNumber('+998991112233')).toBe('+998 99 111 22 33');
  });

  it('normalizes what the form sends to what the server stores', () => {
    expect(normalizeUzPhoneNumber('+998 90 000 00 04')).toBe('+998900000004');
    expect(uzPhoneSchema.parse('+998 99 111 22 33')).toBe('+998991112233');
  });

  it('refuses a number that is not nine digits long', () => {
    expect(() => uzPhoneSchema.parse('+998 90 000')).toThrow();
  });
});

describe('a number typed without +998', () => {
  it('nine digits get the prefix, so the login works without it', () => {
    expect(normalizeUzPhoneNumber('90 000 00 03')).toBe('+998900000003');
    expect(uzPhoneLoginSchema.parse('900000003')).toBe('+998900000003');
  });
  it('a 99-series number keeps its own 99', () => {
    expect(normalizeUzPhoneNumber('99 812 34 56')).toBe('+998998123456');
  });
  it('shows the nine digits grouped, without +998', () => {
    expect(formatUzLocalPhone('+998900000003')).toBe('90 000 00 03');
  });
});
