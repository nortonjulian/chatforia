import ChatHeaderActions from './chat/ChatHeaderActions.jsx';

export default function ChatHome({
  peerUser,
  children,
  showConversationHeader = true,
}) {
  return (
    <>
      {showConversationHeader && peerUser && (
        <div
          className="flex items-center justify-between px-3 py-2"
          style={{ borderBottom: '1px solid var(--mantine-color-gray-3)' }}
        >
          <div className="font-medium">
            {peerUser?.name ||
              peerUser?.username ||
              (peerUser?.id ? `User ${peerUser.id}` : 'Conversation')}
          </div>

          <ChatHeaderActions peerUser={peerUser} />
        </div>
      )}

      {children}
    </>
  );
}