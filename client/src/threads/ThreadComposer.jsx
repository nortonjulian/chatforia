import BottomComposer from '@/components/BottomComposer.jsx';

export default function ThreadComposer({
  value,
  onChange,
  placeholder = 'Type a message…',
  onSend,
  topSlot = null,
  onUploadFiles, // optional
  features = {
    showGif: true,
    showEmoji: true,
    showMic: true,
    showUpload: true,
  },
}) {
  return (
    <BottomComposer
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      onSend={onSend}
      topSlot={topSlot}
      showGif={!!features.showGif}
      showEmoji={!!features.showEmoji}
      showMic={!!features.showMic}
      showUpload={!!features.showUpload}
      onUploadFiles={onUploadFiles}
    />
  );
}
