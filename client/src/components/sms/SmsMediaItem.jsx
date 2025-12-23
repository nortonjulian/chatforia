import { AspectRatio, Image } from '@mantine/core';

export default function SmsMediaItem({ url, mimeType, ratio = 1, radius = 'md' }) {
  const mime = String(mimeType || '').toLowerCase();
  const isVideo = mime.includes('video');
  const isAudio = mime.includes('audio');

  if (isAudio) {
    return (
      <AspectRatio ratio={ratio}>
        <audio controls style={{ width: '100%' }}>
          <source src={url} />
        </audio>
      </AspectRatio>
    );
  }

  if (isVideo) {
    return (
      <AspectRatio ratio={ratio}>
        <video controls style={{ width: '100%', height: '100%', objectFit: 'cover' }}>
          <source src={url} />
        </video>
      </AspectRatio>
    );
  }

  return (
    <AspectRatio ratio={ratio}>
      <Image src={url} alt="Media" fit="cover" radius={radius} fallbackSrc="" />
    </AspectRatio>
  );
}
