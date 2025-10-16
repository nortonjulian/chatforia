import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FileUploader from '@/components/FileUploader';

jest.mock('@/api/axiosClient', () => ({
  __esModule: true,
  default: { post: jest.fn() }, // <-- no out-of-scope vars
}));

import axiosClient from '@/api/axiosClient'; // <-- use the mocked module

// Spy on FormData.append
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

    let resolve;
    const promise = new Promise((res) => (resolve = res));
    axiosClient.post.mockReturnValue(promise); // <-- use the mock here

    render(<FileUploader onUploaded={onUploaded} />);

    const fileInput = screen.getByLabelText(/choose file/i, { selector: 'input[type="file"]' });
    const button = screen.getByRole('button', { name: /choose file/i });

    fireEvent.change(fileInput, { target: { files: [makeFile()] } });

    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Uploading…');

    resolve({ data: payload });

    await waitFor(() => {
      expect(axiosClient.post).toHaveBeenCalledTimes(1);
    });

    const [url, formData, config] = axiosClient.post.mock.calls[0];
    expect(url).toBe('/media/upload');
    expect(formData).toBeInstanceOf(FormData);
    expect(config.headers['Content-Type']).toBe('multipart/form-data');
    expect(config.headers['X-Requested-With']).toBe('XMLHttpRequest');
    expect(typeof config.onUploadProgress).toBe('function');

    expect(appendSpy).toHaveBeenCalledWith('file', expect.any(File));
    expect(onUploaded).toHaveBeenCalledWith(payload);
    expect(fileInput.value).toBe('');
    expect(button).not.toBeDisabled();
    expect(button).toHaveTextContent('Choose file');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('failed upload shows server error and re-enables controls', async () => {
    axiosClient.post.mockRejectedValue({ response: { data: { error: 'Upload blocked' } } });

    render(<FileUploader onUploaded={jest.fn()} />);

    const fileInput = screen.getByLabelText(/choose file/i, { selector: 'input[type="file"]' });
    const button = screen.getByRole('button', { name: /choose file/i });

    fireEvent.change(fileInput, { target: { files: [makeFile()] } });

    expect(await screen.findByRole('alert')).toHaveTextContent('Upload blocked');
    expect(button).not.toBeDisabled();
    expect(button).toHaveTextContent('Choose file');
    expect(fileInput.value).toBe('');
  });

  test('no action when user cancels file selection', () => {
    render(<FileUploader onUploaded={jest.fn()} />);
    const fileInput = screen.getByLabelText(/choose file/i, { selector: 'input[type="file"]' });

    fireEvent.change(fileInput, { target: { files: [] } });
    expect(axiosClient.post).not.toHaveBeenCalled();
  });
});
