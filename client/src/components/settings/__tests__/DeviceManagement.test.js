import { render, screen } from '@testing-library/react';

jest.mock('../../LinkedDevicesPanel.jsx', () => ({
  __esModule: true,
  default: () => <div data-testid="linked-devices-panel">Linked devices</div>,
}));

import DeviceManagement from '../DeviceManagement.jsx';

describe('DeviceManagement', () => {
  test('renders the shared linked-devices panel', () => {
    render(<DeviceManagement />);
    expect(screen.getByTestId('linked-devices-panel')).toBeInTheDocument();
  });
});
