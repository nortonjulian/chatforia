import { useEffect, useState, useCallback } from 'react';


export default function NewChatModalHost({ currentUserId }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(null); // e.g. { text, attachments, files }

  const handleOpen = useCallback((e) => {
    const detail = e?.detail || {};
    setDraft(detail.draft || null);
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    setDraft(null);
  }, []);

  useEffect(() => {
    // Global event bus for opening/closing the StartChatModal
    window.addEventListener('open-new-chat-modal', handleOpen);
    window.addEventListener('close-new-chat-modal', handleClose);
    return () => {
      window.removeEventListener('open-new-chat-modal', handleOpen);
      window.removeEventListener('close-new-chat-modal', handleClose);
    };
  }, [handleOpen, handleClose]);

  if (!open) return null;

  // You can pass draft.text into StartChatModal via initialQuery if you like,
  // or ignore it and just let the user pick recipients first.
  return (
    <NewConversationModal
      currentUserId={currentUserId}
      onClose={handleClose}
      initialQuery={(draft?.text || '').slice(0, 120)} // optional
      hideSearch={false}
    />
  );
}
