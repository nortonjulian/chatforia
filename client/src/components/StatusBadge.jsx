import { ActionIcon, Indicator, Tooltip } from '@mantine/core';
import { IconPhoto } from '@tabler/icons-react';
import { useStatusNotifStore } from '@/stores/statusNotifStore';
import { useNavigate } from 'react-router-dom';

export default function StatusBadge() {
  const unseen = useStatusNotifStore((s) => s.unseen);
  const reset = useStatusNotifStore((s) => s.reset);
  const navigate = useNavigate();

  const openFeed = () => {
    reset();
    navigate('/status'); // or your route
  };

  const button = (
    <ActionIcon
      variant="subtle"
      size="lg" // easier hit target
      aria-label="Open status feed"
      onClick={openFeed}
    >
      <IconPhoto size={18} />
    </ActionIcon>
  );

  return (
    <Tooltip label={unseen > 0 ? `${unseen} new` : 'Status updates'} openDelay={300}>
      {unseen > 0 ? (
        <Indicator label={unseen} processing>
          {button}
        </Indicator>
      ) : (
        button
      )}
    </Tooltip>
  );
}
