import {
  Button,
  Stack,
  Text,
  Title,
} from '@mantine/core';

import {
  IconArrowLeft,
} from '@tabler/icons-react';

import { useNavigate } from 'react-router-dom';

import KeyBackupManager from '@/components/KeyBackupManager.jsx';

export default function SettingsSecurity() {
  const navigate = useNavigate();

  return (
    <div
      style={{
        width: '100%',
        maxWidth: 760,
        margin: '0 auto',
        paddingBottom: 32,
      }}
    >
      <Stack gap="lg">
        <div>
          <Button
            variant="subtle"
            leftSection={
              <IconArrowLeft size={16} />
            }
            onClick={() =>
              navigate('/settings')
            }
          >
            Back to Settings
          </Button>
        </div>

        <div>
          <Title order={3}>
            Secure Message Recovery
          </Title>

          <Text
            c="dimmed"
            mt="xs"
          >
            Create, update, or restore the
            account recovery backup used by
            Chatforia on iPhone, Android,
            and the web.
          </Text>
        </div>

        <KeyBackupManager />
      </Stack>
    </div>
  );
}
