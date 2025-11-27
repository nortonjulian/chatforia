import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PstnCallForm from './PstnCallForm.jsx';

// ---- Mock usePstnCall hook ----
const mockPlaceCall = jest.fn();
const hookState = {
  loading: false,
  error: null,
};

jest.mock('@/hooks/usePstnCall', () => ({
  __esModule: true,
  usePstnCall: () => ({
    placeCall: mockPlaceCall,
    loading: hookState.loading,
    error: hookState.error,
  }),
}));

// ---- Mock PhoneField so we don't depend on react-phone-number-input internals ----
const mockPhoneField = jest.fn((props) => {
  const { label, value, onChange, error } = props;
  return (
    <div>
      <label>
        {label}
        <input
          aria-label={label}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      {error && <div>{error}</div>}
    </div>
  );
});

jest.mock('./PhoneField', () => ({
  __esModule: true,
  default: (props) => mockPhoneField(props),
}));

describe('PstnCallForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    hookState.loading = false;
    hookState.error = null;
  });

  it('disables submit button when no phone is entered and calls placeCall with phone on submit', async () => {
    const user = userEvent.setup();

    render(<PstnCallForm />);

    const button = screen.getByRole('button', {
      name: /call from my chatforia number/i,
    });

    // Initially disabled because phone is empty
    expect(button).toBeDisabled();

    // Our mocked PhoneField renders an input labeled with the `label` prop
    const input = screen.getByLabelText(/call phone number/i);
    await user.type(input, '+15551234567');

    // Now that phone has a value, button should be enabled
    expect(button).not.toBeDisabled();

    mockPlaceCall.mockResolvedValueOnce(undefined);

    await user.click(button);

    expect(mockPlaceCall).toHaveBeenCalledTimes(1);
    expect(mockPlaceCall).toHaveBeenCalledWith('+15551234567');
  });

  it('renders loading state while call is in progress', () => {
    hookState.loading = true;

    render(<PstnCallForm />);

    // Text changes to "Calling…" when loading is true
    const button = screen.getByRole('button', { name: /calling/i });
    expect(button).toBeDisabled();
  });

  it('shows error from usePstnCall via PhoneField', () => {
    hookState.error = 'Failed to place call';

    render(<PstnCallForm />);

    // Our mocked PhoneField renders the error text directly
    expect(screen.getByText('Failed to place call')).toBeInTheDocument();

    // And verify the prop was actually passed
    expect(mockPhoneField).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Failed to place call',
      })
    );
  });

  it('passes custom label and defaultCountry to PhoneField', () => {
    render(
      <PstnCallForm label="Dial number" defaultCountry="GB" />
    );

    // Custom label should be used on the input
    expect(screen.getByLabelText(/dial number/i)).toBeInTheDocument();

    // And PhoneField should receive both label and defaultCountry
    expect(mockPhoneField).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Dial number',
        defaultCountry: 'GB',
      })
    );
  });
});
