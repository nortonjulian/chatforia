import { useEffect, useState } from 'react';
import { readPrivacy, subscribePrivacy } from './preferences';

export default function usePrivacy() {
  const [privacy, setPrivacy] = useState(readPrivacy);
  useEffect(() => subscribePrivacy(() => setPrivacy(readPrivacy())), []);
  return privacy;
}
