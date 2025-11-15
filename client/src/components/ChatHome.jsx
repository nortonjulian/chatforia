// client/src/components/ChatHome.jsx
import { useState } from 'react';
import { Group, Button } from '@mantine/core';
import StatusBar from './StatusBar.jsx';
import StatusComposer from './StatusComposer.jsx';
import StatusViewer from './StatusViewer.jsx';
import ChatHeaderActions from './chat/ChatHeaderActions.jsx';

export default function ChatHome({
  currentUser,
  peerUser, // ⟵ add this to show call/video actions for the current conversation
  children,
  showInlineStatusButton = false,
  showConversationHeader = true, // allow hiding if a parent wants a custom header
}) {
  const [composerOpen, setComposerOpen] = useState(false);
  const [viewer, setViewer] = useState(null); // { author, stories }

  return (
    <>
      {/* Top status strip */}
      <Group
        justify="space-between"
        p="xs"
        style={{ borderBottom: '1px solid var(--mantine-color-gray-3)' }}
      >
        <StatusBar
          currentUserId={currentUser?.id}
          onOpenViewer={(payload) => setViewer(payload)}
        />

        {showInlineStatusButton && (
          <Button size="xs" variant="light" onClick={() => setComposerOpen(true)}>
            New Status
          </Button>
        )}
      </Group>

      {/* Conversation header (title + call/video actions) */}
      {showConversationHeader && peerUser && (
        <div
          className="flex items-center justify-between px-3 py-2"
          style={{ borderBottom: '1px solid var(--mantine-color-gray-3)' }}
        >
          <div className="font-medium">
            {peerUser?.name || peerUser?.username || (peerUser?.id ? `User ${peerUser.id}` : 'Conversation')}
          </div>
          <ChatHeaderActions peerUser={peerUser} />
        </div>
      )}

      {/* Main chat layout/content */}
      {children}

      {/* Overlays */}
      <StatusComposer opened={composerOpen} onClose={() => setComposerOpen(false)} />
      <StatusViewer
        opened={!!viewer}
        onClose={() => setViewer(null)}
        author={viewer?.author}
        stories={viewer?.stories || []}
      />
    </>
  );
}
