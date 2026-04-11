import { Avatar } from '@mantine/core';
import { useState, useEffect } from 'react';

export default function AppAvatar({ src, ...props }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  const finalSrc = !src || failed ? '/default-avatar.png' : src;

  return (
    <Avatar
      src={finalSrc}
      {...props}
      imageProps={{
        onError: () => setFailed(true),
      }}
    />
  );
}