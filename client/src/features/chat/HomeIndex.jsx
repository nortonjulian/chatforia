import { Card, Stack, Text, Button, Divider, Box } from '@mantine/core';
import { useAds } from '@/ads/AdProvider';
import { CardAdWrap } from '@/ads/AdWrappers';
import HouseAdSlot from '@/ads/HouseAdSlot';

export default function HomeIndex() {
  const { isPremium } = useAds();

  return (
    <Box w="100%" mih={420} display="grid" style={{ placeItems: 'center' }}>
      <Card withBorder radius="lg" p="lg" maw={420} w="100%">
        <Stack gap="xs" align="center">
          <Text fw={600} ta="center">
            Select a text or chatroom to begin chatting
          </Text>

          <Button size="md" variant="filled" color="yellow" component="a" href="/random">
            Start your first chat
          </Button>

          {/* Empty-state house promo (non-premium) */}
          {!isPremium && (
            <>
              <Divider label="Sponsored" labelPosition="center" my="xs" />
              <CardAdWrap>
                <HouseAdSlot placement="empty_state_promo" variant="card" />
              </CardAdWrap>
            </>
          )}
        </Stack>
      </Card>
    </Box>
  );
}
