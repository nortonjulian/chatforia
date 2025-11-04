import { useId } from 'react';
import { Box, Text } from '@mantine/core';
import PhoneInput, { isValidPhoneNumber } from 'react-phone-number-input';

// NOTE: Make sure you import the default styles ONCE in your app entry (e.g., main.jsx):
// import 'react-phone-number-input/style.css';

export default function PhoneField({
  label = 'Phone',
  value,
  onChange,
  defaultCountry = 'US',
  required = false,
  disabled = false,
  error,            // optional external error string
  helpText,         // optional helper text shown below the field
  id,               // optional id; falls back to useId()
  withCountrySelect = true, // set false to lock country (no dropdown)
  ariaLabel,        // optional override for aria-label
  ...rest
}) {
  const autoId = useId();
  const inputId = id || autoId;

  // Internal validity (only show if there is a value)
  const invalid = !!value && !isValidPhoneNumber(value);

  return (
    <Box>
      <Text
        size="sm"
        mb={6}
        component="label"
        htmlFor={inputId}
        fw={500}
        style={{ display: 'inline-block' }}
      >
        {label} {required && <span aria-hidden="true" style={{ color: 'var(--mantine-color-red-6)' }}>*</span>}
      </Text>

      <PhoneInput
        id={inputId}
        aria-label={ariaLabel || label}
        aria-invalid={invalid || !!error ? 'true' : 'false'}
        international
        // If you want to force a fixed country (no country select), pass withCountrySelect={false}
        countrySelectProps={withCountrySelect ? { unicodeFlags: true } : { disabled: true }}
        defaultCountry={defaultCountry}
        value={value}
        onChange={onChange}         // returns E.164 like "+14155552671" or undefined
        className="cf-phone-input"
        disabled={disabled}
        {...rest}
      />

      {/* Helper / error messages */}
      {invalid && (
        <Text size="xs" c="red.6" mt={6}>
          Invalid phone number
        </Text>
      )}
      {!!error && (
        <Text size="xs" c="red.6" mt={6}>
          {error}
        </Text>
      )}
      {!!helpText && !invalid && !error && (
        <Text size="xs" c="dimmed" mt={6}>
          {helpText}
        </Text>
      )}

      {/* Optional quick hint when there is *no* value */}
      {!value && !error && helpText === undefined && (
        <Text size="xs" c="dimmed" mt={6}>
          Include country code if needed (e.g., +1 415…)
        </Text>
      )}
    </Box>
  );
}
