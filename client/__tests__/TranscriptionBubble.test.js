import { render, screen } from '@testing-library/react';
import TranscriptionBubble from '../src/components/TranscriptionBubble';

describe('TranscriptionBubble', () => {
  test('renders placeholder when segments are empty', () => {
    render(<TranscriptionBubble />);
    expect(screen.getByText('Transcribing…')).toBeInTheDocument();
  });

  test('renders placeholder when segments produce empty text', () => {
    render(<TranscriptionBubble segments={[{ text: '' }, { text: '' }]} />);
    expect(screen.getByText('Transcribing…')).toBeInTheDocument();
  });

  test('joins all segment texts with spaces', () => {
    const segments = [{ text: 'Hello' }, { text: 'world,' }, { text: 'how are you?' }];
    render(<TranscriptionBubble segments={segments} />);
    expect(screen.getByText('Hello world, how are you?')).toBeInTheDocument();
  });

  test('applies expected styling classes', () => {
    const { container } = render(<TranscriptionBubble segments={[{ text: 'styled' }]} />);
    const div = container.querySelector('div');
    expect(div.className).toContain('mt-2');
    expect(div.className).toContain('text-sm');
    expect(div.className).toContain('bg-gray-50');
    expect(div.className).toContain('border');
    expect(div.className).toContain('rounded-xl');
    expect(div.className).toContain('p-2');
    expect(div.className).toContain('text-gray-800');
    expect(div.className).toContain('whitespace-pre-wrap');
  });
});
