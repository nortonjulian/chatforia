import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import SmsReportModal from '../SmsReportModal.jsx';

function makeProps(overrides = {}) {
  return {
    opened: true,
    onClose: jest.fn(),
    message: {
      id: 42,
      body: 'Suspicious incoming text',
      mediaUrls: [],
    },
    reason: 'spam_scam',
    onReasonChange: jest.fn(),
    details: '',
    onDetailsChange: jest.fn(),
    contextCount: '0',
    onContextCountChange: jest.fn(),
    blockAfterReport: false,
    onBlockAfterReportChange: jest.fn(),
    submitting: false,
    error: '',
    onSubmit: jest.fn(),
    ...overrides,
  };
}

function renderModal(props) {
  return render(
    <MantineProvider>
      <SmsReportModal {...props} />
    </MantineProvider>
  );
}

describe('SmsReportModal', () => {
  test('shows the selected message and privacy disclosure', () => {
    renderModal(makeProps());

    expect(screen.getByText('Suspicious incoming text'))
      .toBeInTheDocument();

    expect(screen.getByText(/sender's phone number/i))
      .toBeInTheDocument();

    expect(screen.getByText(/conversation context/i))
      .toBeInTheDocument();
  });

  test('does not block sender by default', () => {
    renderModal(makeProps());

    expect(
      screen.getByRole('checkbox', {
        name: /block this phone number/i,
      })
    ).not.toBeChecked();
  });

  test('allows the user to opt into blocking', () => {
    const props = makeProps();
    renderModal(props);

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /block this phone number/i,
      })
    );

    expect(props.onBlockAfterReportChange)
      .toHaveBeenCalledWith(true);
  });

  test('allows additional details to be entered', () => {
    const props = makeProps();
    renderModal(props);

    fireEvent.change(
      screen.getByLabelText(/additional details/i),
      { target: { value: 'Potential scam attempt' } }
    );

    expect(props.onDetailsChange)
      .toHaveBeenCalledWith('Potential scam attempt');
  });

  test('submits only when the user clicks Submit report', () => {
    const props = makeProps();
    renderModal(props);

    expect(props.onSubmit).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('button', { name: /submit report/i })
    );

    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  test('shows errors without closing the dialog', () => {
    renderModal(makeProps({
      error: 'You already reported this message',
    }));

    expect(screen.getByRole('dialog'))
      .toBeInTheDocument();

    expect(screen.getByText('You already reported this message'))
      .toBeInTheDocument();
  });

  test('prevents cancellation while submitting', () => {
    const props = makeProps({ submitting: true });
    renderModal(props);

    expect(screen.getByRole('button', { name: 'Cancel' }))
      .toBeDisabled();

    expect(screen.getByRole('button', { name: /submit report/i }))
      .toBeDisabled();
  });
});
