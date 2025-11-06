/**
 * @file client/__tests__/PhoneField.test.js
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

import PhoneField from '@/components/PhoneField';

// --- Mock react-phone-number-input so we can:
// 1) Control validity via isValidPhoneNumber
// 2) Treat <PhoneInput> like a simple <input> that calls onChange(value)
jest.mock('react-phone-number-input', () => {
  const React = require('react');
  const PhoneInput = React.forwardRef(({ onChange, value, ...props }, ref) => (
    <input
      data-testid="phone-input"
      ref={ref}
      value={value || ''}
      onChange={(e) => onChange && onChange(e.target.value)}
      {...props}
    />
  ));
  return {
    __esModule: true,
    default: PhoneInput,
    isValidPhoneNumber: jest.fn(),
  };
});

import { isValidPhoneNumber } from 'react-phone-number-input';

describe('<PhoneField />', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders with custom label and associates it to the input via provided id', () => {
    isValidPhoneNumber.mockReturnValue(true);

    render(
      <PhoneField
        id="my-phone"
        label="Mobile"
        value="+15555550123"
        onChange={() => {}}
      />
    );

    const input = screen.getByLabelText('Mobile');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('id', 'my-phone');
  });

  test('shows required asterisk when required=true', () => {
    isValidPhoneNumber.mockReturnValue(true);

    const { container } = render(
      <PhoneField id="req" label="Phone" required value="+15555550123" onChange={() => {}} />
    );

    // Find the label and the asterisk inside it
    const label = container.querySelector('label');
    expect(label).toHaveTextContent('Phone');
    const star = label.querySelector('span[aria-hidden="true"]');
    expect(star).toBeInTheDocument();
    expect(star).toHaveTextContent('*');
  });

  test('calls onChange when typing into the input', async () => {
    isValidPhoneNumber.mockReturnValue(true);
    const user = userEvent.setup();
    const handleChange = jest.fn();

    render(<PhoneField label="Phone" value="" onChange={handleChange} id="phone" />);

    const input = screen.getByLabelText('Phone');
    await user.type(input, '+1415');

    // Our mock passes the whole string each keystroke
    expect(handleChange).toHaveBeenCalled();
    expect(handleChange).toHaveBeenLastCalledWith('+1415');
  });

  test('marks field invalid and shows validation message for an invalid number', () => {
    // Component checks invalid as: !!value && !isValidPhoneNumber(value)
    isValidPhoneNumber.mockReturnValue(false);

    render(
      <PhoneField
        label="Phone"
        value="+123" // any non-empty value
        onChange={() => {}}
        id="inv"
      />
    );

    const input = screen.getByLabelText('Phone');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Invalid phone number')).toBeInTheDocument();
  });

  test('shows external error string and sets aria-invalid=true even if validity passes', () => {
    isValidPhoneNumber.mockReturnValue(true);

    render(
      <PhoneField
        label="Phone"
        value="+15555550123"
        onChange={() => {}}
        error="Server says no"
        id="err"
      />
    );

    const input = screen.getByLabelText('Phone');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Server says no')).toBeInTheDocument();
    // Internal "Invalid phone number" should not appear because validity passed
    expect(screen.queryByText('Invalid phone number')).not.toBeInTheDocument();
  });

  test('shows helpText when provided (and no error/invalid), hides default hint', () => {
    // With no value, invalid = false (because !!value is false), so helpText should render
    isValidPhoneNumber.mockReturnValue(true);

    render(
      <PhoneField
        label="Phone"
        value={undefined}
        onChange={() => {}}
        helpText="Use E.164 format"
        id="help"
      />
    );

    expect(screen.getByText('Use E.164 format')).toBeInTheDocument();
    // The default hint should NOT be shown when helpText is provided
    expect(
      screen.queryByText(/Include country code if needed/i)
    ).not.toBeInTheDocument();
  });

  test('shows default hint when there is no value, no error, and no helpText', () => {
    isValidPhoneNumber.mockReturnValue(true);

    render(<PhoneField label="Phone" value={undefined} onChange={() => {}} id="hint" />);

    expect(
      screen.getByText('Include country code if needed (e.g., +1 415…)')
    ).toBeInTheDocument();
  });

  test('respects ariaLabel override', () => {
    isValidPhoneNumber.mockReturnValue(true);

    render(
      <PhoneField
        ariaLabel="Phone number field"
        value="+15555550123"
        onChange={() => {}}
        id="aria"
      />
    );

    // The accessible name should be the ariaLabel, not the default "Phone"
    const input = screen.getByLabelText('Phone number field');
    expect(input).toBeInTheDocument();
    expect(screen.queryByLabelText('Phone')).not.toBeInTheDocument();
  });

  test('sets aria-invalid=false when value is valid and there is no external error', () => {
    isValidPhoneNumber.mockReturnValue(true);

    render(
      <PhoneField
        label="Phone"
        value="+15555550123"
        onChange={() => {}}
        id="valid"
      />
    );

    const input = screen.getByLabelText('Phone');
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByText('Invalid phone number')).not.toBeInTheDocument();
  });
});
