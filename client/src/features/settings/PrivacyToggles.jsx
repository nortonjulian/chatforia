import { useState, useEffect } from 'react';
import { Stack, Switch, Group, Text } from '@mantine/core';
import axiosClient from '@/api/axiosClient';
import { useUser } from '@/context/UserContext';
import PremiumGuard from '@/components/PremiumGuard';
import useIsPremium from '@/hooks/useIsPremium';
import { useNavigate } from 'react-router-dom';

export default function PrivacyToggles() {
  const { currentUser, setCurrentUser } = useUser();
  const [state, setState] = useState({
    showReadReceipts: !!currentUser?.showReadReceipts,
    allowExplicitContent: !!currentUser?.allowExplicitContent,
    privacyBlurEnabled: !!currentUser?.privacyBlurEnabled,
    privacyHoldToReveal: !!currentUser?.privacyHoldToReveal,
  });

  useEffect(() => {
    setState({
      showReadReceipts: !!currentUser?.showReadReceipts,
      allowExplicitContent: !!currentUser?.allowExplicitContent,
      privacyBlurEnabled: !!currentUser?.privacyBlurEnabled,
      privacyHoldToReveal: !!currentUser?.privacyHoldToReveal,
    });
  }, [currentUser]);

  async function patch(patchObj) {
    setState((s) => ({ ...s, ...patchObj })); // optimistic
    try {
      const { data } = await axiosClient.patch('/users/me', patchObj);
      setCurrentUser((u) => ({ ...(u || {}), ...(data || patchObj) }));
    } catch {
      // revert if server failed
      setState({
        showReadReceipts: !!currentUser?.showReadReceipts,
        allowExplicitContent: !!currentUser?.allowExplicitContent,
        privacyBlurEnabled: !!currentUser?.privacyBlurEnabled,
        privacyHoldToReveal: !!currentUser?.privacyHoldToReveal,
      });
      alert('Could not save setting. Please try again.');
    }
  }

  const isPremium = useIsPremium();
  const navigate = useNavigate();

  return (
    <Stack gap="sm">
      <Text fw={600}>Privacy & Controls</Text>

      <Switch
        checked={state.showReadReceipts}
        label="Send read receipts"
        description="Let others see when you’ve read their messages."
        onChange={(e) => patch({ showReadReceipts: e.currentTarget.checked })}
      />

      <Switch
        checked={state.allowExplicitContent}
        label="Allow explicit content"
        description="If off, media flagged as explicit will be hidden by default."
        onChange={(e) => patch({ allowExplicitContent: e.currentTarget.checked })}
      />

      <Group gap="md">
        <Switch
          checked={state.privacyBlurEnabled}
          label="Blur chat content until focus"
          description="Great for screenshares or public spaces."
          onChange={(e) => patch({ privacyBlurEnabled: e.currentTarget.checked })}
        />
        <Switch
          checked={state.privacyHoldToReveal}
          label="Hold to reveal"
          description="Only show content while holding/touching."
          onChange={(e) => patch({ privacyHoldToReveal: e.currentTarget.checked })}
          disabled={!state.privacyBlurEnabled}
        />
      </Group>

      {/* Example of a premium-only control (deferred if you want) */}
      <PremiumGuard variant="inline">
        <Switch
          label="Auto-translate all incoming messages (Premium)"
          onChange={(e) => {
            if (!isPremium) return navigate('/settings/upgrade');
            // When you wire this for real, persist a field like autoTranslateMode = 'ALL'
            // patch({ autoTranslateMode: e.currentTarget.checked ? 'ALL' : 'OFF' });
          }}
        />
      </PremiumGuard>
    </Stack>
  );
}
