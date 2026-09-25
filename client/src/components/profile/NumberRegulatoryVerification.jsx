import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Group,
  Loader,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCircleCheck,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import axiosClient from '@/api/axiosClient';

function getRequiredEndUserFields(requirements) {
  const entries = Array.isArray(requirements?.end_user)
    ? requirements.end_user
    : [];

  const fields = [];

  for (const entry of entries) {
    if (!Array.isArray(entry?.fields)) continue;

    for (const field of entry.fields) {
      const name = String(field || '').trim();

      if (name && !fields.includes(name)) {
        fields.push(name);
      }
    }
  }

  return fields;
}

function fieldLabel(field) {
  return String(field || '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export default function NumberRegulatoryVerification({
  e164,
  initialDecision,
  initialResponse,
  onBack,
}) {
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [submittingIdentity, setSubmittingIdentity] = useState(false);
  const [requirements, setRequirements] = useState(null);
  const [attributes, setAttributes] = useState({});
  const [missingFields, setMissingFields] = useState([]);
  const [error, setError] = useState('');
  const [identityReady, setIdentityReady] = useState(false);

  const rejected = initialDecision === 'VERIFICATION_REJECTED';

  const requiredFields = useMemo(
    () => getRequiredEndUserFields(requirements),
    [requirements]
  );

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      setLoading(true);
      setError('');

      try {
        const { data } = await axiosClient.post(
          '/numbers/regulatory/initialize',
          { e164 }
        );

        if (cancelled) return;

        setRequirements(data?.requirements || null);
        if (data?.profile?.endUserSid) {
          setIdentityReady(true);
        }
      } catch (e) {
        if (cancelled) return;

        setError(
          e?.response?.data?.error ||
            e?.response?.data?.reason ||
            t(
              'phoneNumberManager.regulatoryInitializationFailed',
              'Could not load the verification requirements.'
            )
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    initialize();

    return () => {
      cancelled = true;
    };
  }, [e164]);

  const submitIdentity = async () => {
    setSubmittingIdentity(true);
    setError('');
    setMissingFields([]);

    try {
      const { data } = await axiosClient.post(
        '/numbers/regulatory/initialize',
        {
          e164,
          endUserAttributes: attributes,
        }
      );

      setRequirements(data?.requirements || requirements);
      if (data?.profile?.endUserSid) {
        setIdentityReady(true);
      }
    } catch (e) {
      const data = e?.response?.data || {};

      if (data?.reason === 'missing-end-user-fields') {
        setMissingFields(
          Array.isArray(data?.validation?.missingFields)
            ? data.validation.missingFields
            : []
        );

        setError(
          t(
            'phoneNumberManager.regulatoryMissingFields',
            'Complete all required verification fields.'
          )
        );
        return;
      }

      setError(
        data?.error ||
          data?.reason ||
          t(
            'phoneNumberManager.regulatoryIdentityFailed',
            'Could not save the verification information.'
          )
      );
    } finally {
      setSubmittingIdentity(false);
    }
  };

  return (
    <Stack gap="md">
      <div>
        <Title order={4}>
          {t(
            'phoneNumberManager.regulatoryVerificationHeading',
            'Identity verification required'
          )}
        </Title>

        <Text size="sm" c="dimmed">
          {t(
            'phoneNumberManager.regulatoryVerificationDescription',
            'Local regulations require additional information before this number can be assigned.'
          )}
        </Text>
      </div>

      <Text fw={600}>{e164}</Text>

      {rejected && (
        <Alert color="red" icon={<IconAlertTriangle size={16} />}>
          {initialResponse?.rejectionReason ||
            t(
              'phoneNumberManager.regulatoryVerificationRejected',
              'The previous verification was not approved. Review the requirements and submit updated information.'
            )}
        </Alert>
      )}

      {error && (
        <Alert color="red" icon={<IconAlertTriangle size={16} />}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Group justify="center" py="md">
          <Loader />
        </Group>
      ) : identityReady ? (
        <Alert color="green" icon={<IconCircleCheck size={16} />}>
          {t(
            'phoneNumberManager.regulatoryIdentityReady',
            'Identity information is ready.'
          )}
        </Alert>
      ) : (
        <Stack gap="sm">
          {requiredFields.map((field) => (
            <TextInput
              key={field}
              label={fieldLabel(field)}
              value={attributes[field] || ''}
              required
              error={
                missingFields.includes(field)
                  ? t('phoneNumberManager.regulatoryFieldRequired', 'Required')
                  : undefined
              }
              onChange={(event) => {
                const value = event.currentTarget.value;

                setAttributes((current) => ({
                  ...current,
                  [field]: value,
                }));

                setMissingFields((current) =>
                  current.filter((name) => name !== field)
                );
              }}
            />
          ))}

          {requiredFields.length === 0 && (
            <Text size="sm" c="dimmed">
              {t(
                'phoneNumberManager.regulatoryNoIdentityFields',
                'No additional identity fields are required.'
              )}
            </Text>
          )}

          <Button onClick={submitIdentity} loading={submittingIdentity}>
            {t('phoneNumberManager.regulatoryContinue', 'Continue')}
          </Button>
        </Stack>
      )}

      <Group justify="space-between">
        <Button
          variant="subtle"
          leftSection={<IconArrowLeft size={16} />}
          onClick={onBack}
        >
          {t('common.back', 'Back')}
        </Button>
      </Group>
    </Stack>
  );
}
