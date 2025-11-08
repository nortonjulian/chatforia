import { useState } from 'react';
import { Group, Button } from '@mantine/core';
import StatusBar from './StatusBar.jsx';
import StatusComposer from './StatusComposer.jsx';
import StatusViewer from './StatusViewer.jsx';

export default function ChatHome({ currentUser, children, showInlineStatusButton = false }) {
  const [composerOpen, setComposerOpen] = useState(false);
  const [viewer, setViewer] = useState(null); // { author, stories }

  return (
    <>
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

      {/* your chat layout below */}
      {children}

      <StatusComposer
        opened={composerOpen}
        onClose={() => setComposerOpen(false)}
      />
      <StatusViewer
        opened={!!viewer}
        onClose={() => setViewer(null)}
        author={viewer?.author}
        stories={viewer?.stories || []}
      />
    </>
  );
}
