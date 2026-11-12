import { forwardRef, type InputHTMLAttributes } from 'react';
import { formatUzLocalPhone, UZ_PHONE_LOCAL_DISPLAY_LENGTH } from '@bigant/shared';

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'inputMode' | 'maxLength' | 'onChange' | 'type' | 'value'
> & {
  value: string;
  onChange: (value: string) => void;
};

/**
 * A phone field without +998 (owner, 28.10.2026): the nine digits only,
 * "90 123 45 67". The schemas add the prefix back (normalizeUzPhoneNumber), so
 * what is saved and signed in with is still +998…
 */
export const UzPhoneInput = forwardRef<HTMLInputElement, Props>(function UzPhoneInput(
  { autoComplete = 'tel', onChange, value, placeholder = '90 123 45 67', ...props },
  ref,
) {
  return (
    <input
      {...props}
      ref={ref}
      type="tel"
      inputMode="numeric"
      autoComplete={autoComplete}
      maxLength={UZ_PHONE_LOCAL_DISPLAY_LENGTH}
      placeholder={placeholder}
      value={formatUzLocalPhone(value)}
      onChange={(event) => onChange(formatUzLocalPhone(event.target.value))}
    />
  );
});
