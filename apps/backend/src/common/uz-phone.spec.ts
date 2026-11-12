import { formatUzPhoneNumber, isCompleteUzPhoneNumber } from '@bigant/shared';

describe('Uzbek phone numbers', () => {
  it('accepts every operator code with seven digits after it', () => {
    for (const code of ['90', '91', '93', '94', '95', '97', '98', '99', '33', '88', '77', '20', '50', '55', '71', '66', '65', '78']) {
      expect(isCompleteUzPhoneNumber(`+998${code}1234567`)).toBe(true);
    }
  });

  it('refuses nine digits that start with a pair no network owns', () => {
    expect(isCompleteUzPhoneNumber('+998121234567')).toBe(false);
    expect(isCompleteUzPhoneNumber('+998001234567')).toBe(false);
    expect(isCompleteUzPhoneNumber('+998451234567')).toBe(false);
  });

  it('refuses a short or a long number', () => {
    expect(isCompleteUzPhoneNumber('+99890123456')).toBe(false);
    expect(isCompleteUzPhoneNumber('+9989012345678')).toBe(false);
  });

  it('keeps only digits as it formats, so letters never land in the box', () => {
    expect(formatUzPhoneNumber('+998 9a0 1b2c3 45 67')).toBe('+998 90 123 45 67');
  });
});
