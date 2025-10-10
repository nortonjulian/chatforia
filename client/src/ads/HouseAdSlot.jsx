import { Card, Group, Text, Button, Image } from '@mantine/core';
import { ADS_CONFIG } from './config';
import { useNavigate } from 'react-router-dom';

export default function HouseAdSlot({ placement, style }) {
  const nav = useNavigate();
  const pool = ADS_CONFIG?.house?.[placement] ?? ADS_CONFIG?.house?.default ?? [];
  const creative = pool[0]; 

  if (!creative) return null;

  if (creative.kind === 'image') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', ...style }}>
        <a href={creative.href} target="_blank" rel="noreferrer noopener">
          <Image src={creative.img} alt={creative.alt || 'Advertisement'} radius="md" />
        </a>
      </div>
    );
  }

  console.log('[HouseAdSlot]', placement);
  return (
    <Card withBorder radius="lg" p="md" style={style}>
      <Group justify="space-between" align="center">
        <div>
          <Text fw={600}>{creative.title}</Text>
          {creative.body ? <Text c="dimmed" size="sm">{creative.body}</Text> : null}
        </div>
        <Button
          onClick={() =>
            creative.href?.startsWith('/')
              ? nav(creative.href)
              : window.open(creative.href, '_blank', 'noopener,noreferrer')
          }
        >
          {creative.cta || 'Learn more'}
        </Button>
      </Group>
    </Card>
  );
}
