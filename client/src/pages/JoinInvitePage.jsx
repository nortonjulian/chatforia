import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, Stack, Text, Button, Badge, Group } from '@mantine/core';
import axiosClient from '../api/axiosClient';
import { useUser } from '../context/UserContext';

export default function JoinInvitePage() {
  const { code } = useParams();
  const nav = useNavigate();
  const { currentUser } = useUser();
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const { data } = await axiosClient.get(`/invites/${code}`);
        setInfo(data);
      } catch {
        setInfo({ status: 'invalid' });
      } finally {
        setLoading(false);
      }
    })();
  }, [code]);

  const accept = async () => {
    if (!currentUser) {
      // redirect to login, then back here
      nav(`/?next=/join/${code}`);
      return;
    }
    setJoining(true);
    setJoinError('');
    try {
      const { data } = await axiosClient.post(`/invites/${code}/accept`);
      if (!data?.ok || !data?.roomId) throw new Error('Group join was not confirmed.');
      nav(`/chat/${data.roomId}`);
    } catch (error) {
      setJoinError(error?.response?.data?.error || error?.message || 'Could not join group.');
    } finally {
      setJoining(false);
    }
  };

  if (loading) return <Text>Loading…</Text>;
  if (!info || info.status !== 'ok') {
    return (
      <Card withBorder maw={420} mx="auto" mt="xl" p="lg">
        <Stack>
          <Text fw={600}>Invite link</Text>
          <Badge color="red">{info?.status || 'invalid'}</Badge>
          <Text c="dimmed">This invite is no longer valid.</Text>
        </Stack>
      </Card>
    );
  }

  return (
    <Card withBorder maw={420} mx="auto" mt="xl" p="lg">
      <Stack>
        <Text fw={600}>Join “{info.roomName}”</Text>
        <Group>
          <Badge color="green">Valid</Badge>
        </Group>
        {joinError && <Text role="alert" c="red" size="sm">{joinError}</Text>}
        <Button onClick={accept} loading={joining} disabled={joining}>Join chat</Button>
      </Stack>
    </Card>
  );
}
