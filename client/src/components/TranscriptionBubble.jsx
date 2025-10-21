export default function TranscriptionBubble({ segments = [] }) {
  const text = segments.map((s) => s?.text || '').join(' ').trim();
  return (
    <div className="mt-2 text-sm bg-gray-50 border rounded-xl p-2 text-gray-800 whitespace-pre-wrap">
      {text || 'Transcribing…'}
    </div>
  );
}
