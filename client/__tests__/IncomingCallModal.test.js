import { render, screen, fireEvent } from '@testing-library/react';

// ----- Controlled test doubles (allowed in mock factory because names start with "mock") -----
let mockIncoming = {
  mode: 'VIDEO',
  fromUser: { username: 'alice' },
};
const mockAccept = jest.fn();
const mockReject = jest.fn();

// Mock the exact modules the component imports
jest.mock('@/context/CallContext', () => ({
  __esModule: true,
  useCall: () => ({
    incoming: mockIncoming,
    acceptCall: mockAccept,
    rejectCall: mockReject,
  }),
}));

jest.mock('@/utils/safeToast', () => ({
  __esModule: true,
  toast: {
    ok: jest.fn(),
    info: jest.fn(),
    err: jest.fn(),
  },
}));

// SUT
import IncomingCallModal from '@/components/IncomingCallModal';

describe('IncomingCallModal', () => {
  beforeEach(() => {
    mockAccept.mockClear();
    mockReject.mockClear();
  });

  test('renders and wires Accept/Reject', () => {
    // incoming call present
    mockIncoming = { mode: 'VIDEO', fromUser: { username: 'alice' } };

    render(<IncomingCallModal />);

    expect(screen.getByText(/incoming/i)).toBeInTheDocument();

    const acceptBtn  = screen.getByRole('button', { name: /accept|answer/i });
    const declineBtn = screen.getByRole('button', { name: /decline|reject|deny/i });

    fireEvent.click(acceptBtn);
    expect(mockAccept).toHaveBeenCalled();

    fireEvent.click(declineBtn);
    expect(mockReject).toHaveBeenCalled();
  });

  test('renders nothing if no incoming call', () => {
    // no incoming call
    mockIncoming = null;

    const { queryByText, queryByRole } = render(<IncomingCallModal />);
    expect(queryByText(/incoming/i)).toBeNull();
    expect(queryByRole('button', { name: /accept|answer/i })).toBeNull();
    expect(queryByRole('button', { name: /decline|reject|deny/i })).toBeNull();
  });
});
