import { Box, Card, Stack, Text, Button } from '@mantine/core';

export default function HomeIndex() {
  const handleSendMessage = () => {
    // Open the StartChatModal via the global event.
    window.dispatchEvent(new CustomEvent('open-new-chat-modal'));
    // No fallback navigation — this should ONLY open the modal.
  };

  return (
    <Box
      role="region"
      aria-label="Home"
      w="100%"
      mih="70vh"
      display="grid"
      style={{ placeItems: 'center' }}
    >
      <Card
        withBorder
        radius="lg"
        p="lg"
        maw={380}
        w="100%"
        style={{ textAlign: 'center' }}
      >
        <Stack gap="xs" align="center">
          <Text fw={700} size="lg">Your messages</Text>
          <Text c="dimmed" size="sm" mb="xs">Send a message to start a chat.</Text>

          <Button
            size="md"
            onClick={handleSendMessage}
            style={{ whiteSpace: 'nowrap' }}
          >
            Send message
          </Button>
        </Stack>
      </Card>
    </Box>
  );
}
