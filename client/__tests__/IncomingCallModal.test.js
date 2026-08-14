import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

let mockIncoming = {
  mode: 'VIDEO',
  fromUser: {
    username: 'alice',
  },
};

const mockAccept = jest.fn();
const mockReject = jest.fn();
const mockShowNotification =
  jest.fn();

jest.mock(
  '@/context/CallContext',
  () => ({
    __esModule: true,
    useCall: () => ({
      incoming: mockIncoming,
      acceptCall: mockAccept,
      rejectCall: mockReject,
    }),
  })
);

jest.mock(
  '@mantine/notifications',
  () => ({
    __esModule: true,
    notifications: {
      show: (...args) =>
        mockShowNotification(
          ...args
        ),
    },
  })
);

import IncomingCallModal from '@/components/IncomingCallModal';

describe('IncomingCallModal', () => {
  beforeEach(() => {
    mockIncoming = {
      mode: 'VIDEO',
      fromUser: {
        username: 'alice',
      },
    };

    mockAccept.mockReset();
    mockReject.mockReset();
    mockShowNotification
      .mockReset();

    mockAccept
      .mockResolvedValue(undefined);

    mockReject
      .mockResolvedValue(undefined);
  });

  test(
    'renders styled controls and wires acceptance and rejection',
    async () => {
      render(<IncomingCallModal />);

      expect(
        screen.getByText(
          'Incoming video call'
        )
      ).toBeInTheDocument();

      expect(
        screen.getByText('alice')
      ).toBeInTheDocument();

      const acceptButton =
        screen.getByRole(
          'button',
          {
            name: /accept/i,
          }
        );

      fireEvent.click(
        acceptButton
      );

      await waitFor(() => {
        expect(
          mockAccept
        ).toHaveBeenCalledTimes(1);
      });

      await waitFor(() => {
        expect(
          acceptButton
        ).not.toBeDisabled();
      });

      fireEvent.click(
        screen.getByRole(
          'button',
          {
            name: /decline/i,
          }
        )
      );

      await waitFor(() => {
        expect(
          mockReject
        ).toHaveBeenCalledTimes(1);
      });
    }
  );

  test(
    'keeps hook order stable when a call appears',
    () => {
      mockIncoming = null;

      const { rerender } =
        render(
          <IncomingCallModal />
        );

      expect(
        screen.queryByText(
          'Incoming video call'
        )
      ).not.toBeInTheDocument();

      mockIncoming = {
        mode: 'VIDEO',
        callerName: 'Reviewer',
      };

      rerender(
        <IncomingCallModal />
      );

      expect(
        screen.getByText(
          'Incoming video call'
        )
      ).toBeInTheDocument();

      expect(
        screen.getByText('Reviewer')
      ).toBeInTheDocument();
    }
  );

  test(
    'shows a visible acceptance error',
    async () => {
      mockAccept
        .mockRejectedValueOnce(
          new Error(
            'Video room unavailable'
          )
        );

      render(<IncomingCallModal />);

      fireEvent.click(
        screen.getByRole(
          'button',
          {
            name: /accept/i,
          }
        )
      );

      await waitFor(() => {
        expect(
          mockShowNotification
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            color: 'red',
            title:
              'Could not answer call',
            message:
              'Video room unavailable',
          })
        );
      });
    }
  );

  test(
    'renders nothing without an incoming call',
    () => {
      mockIncoming = null;

      render(
        <IncomingCallModal />
      );

      expect(
        screen.queryByText(
          /incoming (video|audio) call/i
        )
      ).not.toBeInTheDocument();
    }
  );
});
