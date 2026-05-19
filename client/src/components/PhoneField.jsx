import { useId } from 'react';
import { Box, Text } from '@mantine/core';
import PhoneInput, { isValidPhoneNumber } from 'react-phone-number-input';
import { useTranslation } from 'react-i18next';

// NOTE: Make sure you import the default styles ONCE in your app entry (e.g., main.jsx):
// import 'react-phone-number-input/style.css';

export default function PhoneField({
  label,
  value,
  onChange,
  defaultCountry = 'US',
  required = false,
  disabled = false,
  error,
  helpText,
  id,
  withCountrySelect = true,
  ariaLabel,
  ...rest
}) {
  const autoId = useId();
  const inputId = id || autoId;
  const { t } = useTranslation();

  const resolvedLabel = label || t('phoneField.label', 'Phone');
  // Internal validity (only show if there is a value)
  const invalid = !!value && !isValidPhoneNumber(value);

  return (
    <Box>
      {/* Real <label> element for accessibility + tests */}
      <label htmlFor={inputId} style={{ display: 'inline-block' }}>
        <Text
          size="sm"
          mb={6}
          fw={500}
          component="span"
        >
          {resolvedLabel}{' '}
          {required && (
            <span
              aria-hidden="true"
              style={{ color: 'var(--mantine-color-red-6)' }}
            >
              *
            </span>
          )}
        </Text>
      </label>

      <PhoneInput
        id={inputId}
        aria-label={ariaLabel || resolvedLabel}
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
      {invalid && !error && (
        <Text size="xs" c="red.6" mt={6}>
          {t('phoneField.invalid', 'Invalid phone number')}
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
          {t('phoneField.hint', 'Include country code if needed (e.g., +1 415…)')}
        </Text>
      )}
    </Box>
  );
}
