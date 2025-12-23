import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

export default function NewChatModalHost() {
  const navigate = useNavigate();

  const handleOpen = useCallback(() => {
    navigate('/'); // HomeIndex
    // optionally: dispatch an event HomeIndex listens for to focus the To field
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('focus-home-to'));
    }, 0);
  }, [navigate]);

  useEffect(() => {
    window.addEventListener('open-new-chat-modal', handleOpen);
    return () => window.removeEventListener('open-new-chat-modal', handleOpen);
  }, [handleOpen]);

  return null;
}
