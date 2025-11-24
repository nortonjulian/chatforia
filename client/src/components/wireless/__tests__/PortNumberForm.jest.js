import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

import PortNumberForm from './PortNumberForm.jsx';
import axios from 'axios';

jest.mock('axios');

describe('PortNumberForm', () => {
  const user = userEvent.setup();

  const fillRequiredFields = async () => {
    await user.type(
      screen.getByLabelText('Phone number to port'),
      '+1 555 123 4567'
    );
    await user.type(
      screen.getByLabelText('Full name on the account'),
      'Jane Doe'
    );
    await user.type(
      screen.getByLabelText('Address line 1'),
      '123 Main St'
    );
    await user.type(screen.getByLabelText('City'), 'Denver');
    await user.type(screen.getByLabelText('State'), 'CO');
    await user.type(screen.getByLabelText('Postal code'), '80202');
  };

  test('renders all key fields and submit button', () => {
    render(<PortNumberForm />);

    expect(
      screen.getByLabelText('Phone number to port')
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('Current carrier')
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('Account number')
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('Port-out PIN / password')
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('Full name on the account')
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('Address line 1')
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('Address line 2 (optional)')
    ).toBeInTheDocument();
    expect(screen.getByLabelText('City')).toBeInTheDocument();
    expect(screen.getByLabelText('State')).toBeInTheDocument();
    expect(screen.getByLabelText('Postal code')).toBeInTheDocument();
    expect(screen.getByLabelText('Country')).toBeInTheDocument();

    expect(
      screen.getByRole('button', { name: 'Submit port request' })
    ).toBeInTheDocument();
  });

  test('submits successfully, shows success message and calls onSubmitted', async () => {
    const onSubmitted = jest.fn();
    const responseData = { id: 'port_123', status: 'pending' };

    axios.post.mockResolvedValueOnce({ data: responseData });

    render(<PortNumberForm onSubmitted={onSubmitted} />);

    await fillRequiredFields();

    // Confirm default country value is present before submit
    expect(screen.getByLabelText('Country')).toHaveValue('US');

    const submitButton = screen.getByRole('button', {
      name: 'Submit port request',
    });

    await user.click(submitButton);

    // While submitting, button should be disabled and show loading text
    expect(submitButton).toBeDisabled();
    expect(submitButton).toHaveTextContent('Submitting…');

    await waitFor(() => {
      // Back to normal after submit completes
      expect(submitButton).not.toBeDisabled();
      expect(submitButton).toHaveTextContent('Submit port request');
    });

    // Correct API call
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post).toHaveBeenCalledWith('/api/porting', {
      phoneNumber: '+1 555 123 4567',
      carrier: '',
      accountNumber: '',
      pin: '',
      fullName: 'Jane Doe',
      addressLine1: '123 Main St',
      addressLine2: '',
      city: 'Denver',
      state: 'CO',
      postalCode: '80202',
      country: 'US',
    });

    // Success message
    expect(
      screen.getByText(
        'Port request submitted! We’ll keep you updated.'
      )
    ).toBeInTheDocument();

    // onSubmitted callback
    expect(onSubmitted).toHaveBeenCalledWith(responseData);
  });

  test('shows API error message when request fails with server error', async () => {
    axios.post.mockRejectedValueOnce({
      response: { data: { error: 'Carrier account mismatch.' } },
    });

    render(<PortNumberForm />);

    await fillRequiredFields();

    const submitButton = screen.getByRole('button', {
      name: 'Submit port request',
    });

    await user.click(submitButton);

    await waitFor(() => {
      expect(
        screen.getByText('Carrier account mismatch.')
      ).toBeInTheDocument();
    });

    // No success message
    expect(
      screen.queryByText(
        'Port request submitted! We’ll keep you updated.'
      )
    ).not.toBeInTheDocument();
  });

  test('falls back to generic error message when no server error text is provided', async () => {
    axios.post.mockRejectedValueOnce(new Error('Network error'));

    render(<PortNumberForm />);

    await fillRequiredFields();

    const submitButton = screen.getByRole('button', {
      name: 'Submit port request',
    });

    await user.click(submitButton);

    await waitFor(() => {
      expect(
        screen.getByText('Something went wrong.')
      ).toBeInTheDocument();
    });
  });
});
