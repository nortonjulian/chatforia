import { useEffect, useState, useRef } from 'react';
import socket from '../socket';
import axiosClient from '../api/axiosClient';
import {
  Box,
  Paper,
  Title,
  Text,
  Button,
  Group,
  TextInput,
  ScrollArea,
  Stack,
  Badge,
  Tooltip,
} from '@mantine/core';

export default function RandomChat({ currentUser }) {
  const [roomId, setRoomId] = useState(null);         // number or string (AI)
  const [partnerName, setPartnerName] = useState(null);
  const [partnerId, setPartnerId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('Searching…');
  const [offerAI, setOfferAI] = useState(false);

  const endRef = useRef(null);
  const viewportRef = useRef(null);

  useEffect(() => {
    // Begin matching
    socket.emit('find_random_chat');

    const onWaiting = (msg) => setStatus(msg || 'Looking for a partner…');
    const onNoPartner = ({ message }) => {
      setStatus(message || 'No partner found right now.');
      setOfferAI(true);
    };
    const onPairFound = ({ roomId, partner, partnerId }) => {
      setRoomId(roomId);
      setPartnerName(partner || 'Partner');
      setPartnerId(partnerId ?? null);
      setStatus(`Connected to ${partner || 'Partner'}`);
      setMessages([]);
    };
    const onSkipped = (msg) => {
      setStatus(msg || 'Stopped searching.');
      setRoomId(null);
      setPartnerName(null);
      setPartnerId(null);
    };
    const onPartnerLeft = (msg) => {
      setStatus(msg || 'Partner disconnected.');
      setRoomId(null);
      setPartnerName(null);
      setPartnerId(null);
      setOfferAI(false);
    };
    const onReceive = (msg) => {
      // Expect: { content, senderId, randomChatRoomId, sender, createdAt }
      if (!roomId) return;
      if (String(msg.randomChatRoomId) !== String(roomId)) return;
      setMessages((prev) => [...prev, msg]);
    };

    socket.on('waiting', onWaiting);
    socket.on('no_partner', onNoPartner);
    socket.on('pair_found', onPairFound);
    socket.on('chat_skipped', onSkipped);
    socket.on('partner_disconnected', onPartnerLeft);
    socket.on('receive_message', onReceive);

    return () => {
      socket.off('waiting', onWaiting);
      socket.off('no_partner', onNoPartner);
      socket.off('pair_found', onPairFound);
      socket.off('chat_skipped', onSkipped);
      socket.off('partner_disconnected', onPartnerLeft);
      socket.off('receive_message', onReceive);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || !roomId) return;

    const outgoing = {
      content: text,
      senderId: currentUser.id,
      randomChatRoomId: roomId,
    };

    socket.emit('send_message', outgoing);

    // Optimistic append
    setMessages((prev) => [
      ...prev,
      {
        ...outgoing,
        sender: { id: currentUser.id, username: currentUser.username },
        createdAt: new Date().toISOString(),
      },
    ]);
    setInput('');
  };

  const handleSkip = () => {
    socket.emit('skip_random_chat');
    setMessages([]);
    setPartnerName(null);
    setPartnerId(null);
    setRoomId(null);
    setOfferAI(false);
  };

  const handleSave = async () => {
    if (!partnerId || !roomId || typeof roomId === 'string') {
      alert('This chat cannot be saved (no human partner).');
      return;
    }
    try {
      await axiosClient.post('/random-chats', {
        messages: messages.map((m) => ({
          content: m.content,
          senderId: m.senderId ?? m.sender?.id ?? currentUser.id,
        })),
        participants: [currentUser.id, partnerId],
      });
      alert('Chat saved!');
    } catch (error) {
      console.error('Error saving chat:', error);
      alert('Failed to save chat');
    }
  };

  const handleStartAI = () => {
    socket.emit('start_ai_chat');
    setStatus('Connected to OrbitBot');
    setOfferAI(false);
    setMessages([]);
  };

  // auto-scroll on new messages
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <Paper
      withBorder
      shadow="sm"
      radius="xl"
      p="md"
      h="100%"
      style={{ display: 'flex', flexDirection: 'column' }}
    >
      <Group justify="space-between" mb="xs">
        <Title order={4}>Random Chat</Title>
        {roomId ? (
          <Badge variant="light" radius="sm">
            {partnerName || 'OrbitBot'}
          </Badge>
        ) : null}
      </Group>

      <Text size="sm" c="dimmed">
        {status}
      </Text>

      {offerAI && (
        <Button
          onClick={handleStartAI}
          variant="filled"
          color="violet"
          mt="xs"
          maw={220}
        >
          Chat with OrbitBot
        </Button>
      )}

      {/* Messages */}
      <ScrollArea style={{ flex: 1 }} mt="md" viewportRef={viewportRef}>
        <Stack gap="xs" p="xs">
          {messages.map((m, i) => {
            const mine = (m.senderId ?? m.sender?.id) === currentUser.id;
            const bubbleStyles = mine
              ? { background: 'var(--mantine-color-orbit-6, #4c6ef5)', color: 'white' }
              : { background: 'var(--mantine-color-gray-2)', color: 'black' };

            return (
              <Box
                key={`${i}-${m.createdAt || ''}`}
                style={{
                  display: 'flex',
                  justifyContent: mine ? 'flex-end' : 'flex-start',
                }}
              >
                <Box
                  px="md"
                  py="xs"
                  style={{ maxWidth: 420, borderRadius: 16, ...bubbleStyles }}
                >
                  <Tooltip
                    label={new Date(m.createdAt || Date.now()).toLocaleTimeString()}
                    withArrow
                  >
                    <Text size="xs" fw={600} c={mine ? 'white' : 'dark.6'} mb={4}>
                      {mine ? 'You' : m.sender?.username || partnerName || 'OrbitBot'}
                    </Text>
                  </Tooltip>
                  <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                    {m.content}
                  </Text>
                </Box>
              </Box>
            );
          })}
          <div ref={endRef} />
        </Stack>
      </ScrollArea>

      {/* Composer */}
      {roomId && (
        <Group mt="sm" wrap="nowrap" align="end">
          <TextInput
            style={{ flex: 1 }}
            placeholder="Type a message…"
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <Button onClick={handleSend} disabled={!input.trim()}>
            Send
          </Button>
          <Button color="yellow" onClick={handleSkip} variant="filled">
            Skip
          </Button>
          <Button
            color="green"
            onClick={handleSave}
            variant="filled"
            disabled={!partnerId || typeof roomId === 'string'}
            title={
              !partnerId || typeof roomId === 'string'
                ? 'Only human-to-human chats can be saved'
                : undefined
            }
          >
            Save
          </Button>
        </Group>
      )}
    </Paper>
  );
}
