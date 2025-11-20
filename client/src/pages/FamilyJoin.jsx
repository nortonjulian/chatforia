import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Stack, Title, Text, Card, Button, Alert } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import { useUser } from '../context/UserContext';
import { joinFamily } from '../api/family';

export default function FamilyJoin() {
  const { token } = useParams();
  const { t } = useTranslation();
  const { currentUser } = useUser();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  const handleJoin = async () => {
    if (!currentUser) {
      navigate(`/login?next=/family/join/${token}`);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await joinFamily(token);
      setDone(true);
    } catch (e) {
      console.error('Join family failed', e);
      setError(
        t(
          'family.join.error',
          'We could not add you to this family. The invite may be invalid or expired.',
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Stack maw={600} mx="auto" p="md">
      <Title order={2}>{t('family.join.title', 'Join a family')}</Title>

      <Card radius="xl" withBorder>
        <Stack gap="sm">
          {!done ? (
            <>
              <Text>
                {t(
                  'family.join.body',
                  'You have been invited to join a Chatforia Family and share their data pool.',
                )}
              </Text>
              {error && (
                <Alert color="red" variant="light" icon={<Info size={16} />}>
                  {error}
                </Alert>
              )}
              <Button onClick={handleJoin} loading={loading}>
                {currentUser
                  ? t('family.join.cta', 'Accept and join family')
                  : t('family.join.ctaLogin', 'Sign in and join family')}
              </Button>
            </>
          ) : (
            <>
              <Text>
                {t(
                  'family.join.success',
                  'You have joined this family. You now share their data pool.',
                )}
              </Text>
              <Button component={Link} to="/family">
                {t('family.join.goFamily', 'Go to family dashboard')}
              </Button>
            </>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}
