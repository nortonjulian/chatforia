import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FileUploader from '@/components/FileUploader'; // update path if needed

// ---- Mocks ----
const postMock = jest.fn();
jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: { post: (...args) => postMock(...args) },
}));

// Spy on FormData.append to ensure field name is "file"
const appendSpy = jest.spyOn(FormData.prototype, 'append');

beforeEach(() => {
  jest.clearAllMocks();
});

function makeFile(name = 'pic.png', type = 'image/png', content = 'x') {
  return new File([content], name, { type });
}

describe('FileUploader', () => {
  test('successful upload posts FormData with headers, calls onUploaded, resets input and UI', async () => {
    const onUploaded = jest.fn();
    const payload = { ok: true, url: 'https://cdn/x.png', key: 'k', contentType: 'image/png', size: 1 };
    // Keep promise controllable to assert interim "Uploading…" state
    let resolve;
    const promise = new Promise((res) => (resolve = res));
    postMock.mockReturnValue(promise);

    render(<FileUploader onUploaded={onUploaded} />);

    const fileInput = screen.getByLabelText(/choose file/i, { selector: 'input[type="file"]' });
    const button = screen.getByRole('button', { name: /choose file/i });

    // Select a file => triggers upload
    const file = makeFile();
    fireEvent.change(fileInput, { target: { files: [file] } });

    // While pending
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Uploading…');

    // Resolve the request
    resolve({ data: payload });

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });

    // Axios args
    const [url, formData, config] = postMock.mock.calls[0];
    expect(url).toBe('/media/upload');
    expect(formData).toBeInstanceOf(FormData);
    expect(config.headers['Content-Type']).toBe('multipart/form-data');
    expect(config.headers['X-Requested-With']).toBe('XMLHttpRequest');
    expect(typeof config.onUploadProgress).toBe('function');

    // FormData field name "file" was appended
    expect(appendSpy).toHaveBeenCalledWith('file', file);

    // Callback received server data
    expect(onUploaded).toHaveBeenCalledWith(payload);

    // Input reset so same file can be picked again
    expect(fileInput.value).toBe('');

    // UI restored
    expect(button).not.toBeDisabled();
    expect(button).toHaveTextContent('Choose file');

    // No error
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('failed upload shows server error and re-enables controls', async () => {
    const serverErr = { response: { data: { error: 'Upload blocked' } } };
    postMock.mockRejectedValue(serverErr);

    render(<FileUploader onUploaded={jest.fn()} />);

    const fileInput = screen.getByLabelText(/choose file/i, { selector: 'input[type="file"]' });
    const button = screen.getByRole('button', { name: /choose file/i });

    fireEvent.change(fileInput, { target: { files: [makeFile()] } });

    // After failure, alert appears and controls are enabled
    expect(await screen.findByRole('alert')).toHaveTextContent('Upload blocked');
    expect(button).not.toBeDisabled();
    expect(button).toHaveTextContent('Choose file');
    // Input reset after attempt
    expect(fileInput.value).toBe('');
  });

  test('no action when user cancels file selection', () => {
    render(<FileUploader onUploaded={jest.fn()} />);
    const fileInput = screen.getByLabelText(/choose file/i, { selector: 'input[type="file"]' });

    fireEvent.change(fileInput, { target: { files: [] } });
    expect(postMock).not.toHaveBeenCalled();
  });
});
