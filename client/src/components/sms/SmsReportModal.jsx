import {
  Modal,
  Stack,
  Select,
  Textarea,
  Checkbox,
  Alert,
  Text,
  Group,
  Button,
} from '@mantine/core';

export default function SmsReportModal({
  opened,
  onClose,
  message,
  reason,
  onReasonChange,
  details,
  onDetailsChange,
  contextCount,
  onContextCountChange,
  blockAfterReport,
  onBlockAfterReportChange,
  submitting,
  error,
  onSubmit,
}) {
  return (
    <Modal
      opened={opened}
      onClose={submitting ? () => {} : onClose}
      title="Report text message"
      centered
      radius="lg"
      closeOnEscape={!submitting}
      closeOnClickOutside={!submitting}
    >
      <Stack gap="md">
        <Text size="sm">
          Report an incoming SMS or MMS message to Chatforia's moderation team.
        </Text>

        <Select
          label="Reason"
          value={reason}
          onChange={(value) => onReasonChange(value || 'other')}
          allowDeselect={false}
          data={[
            { value: 'harassment', label: 'Harassment' },
            { value: 'threats', label: 'Threats or violence' },
            { value: 'hate', label: 'Hate or abusive conduct' },
            { value: 'sexual_content', label: 'Sexual content' },
            { value: 'spam_scam', label: 'Spam or scam' },
            { value: 'impersonation', label: 'Impersonation' },
            { value: 'other', label: 'Other' },
          ]}
        />

        <Select
          label="Include previous messages"
          value={contextCount}
          onChange={(value) => onContextCountChange(value || '0')}
          allowDeselect={false}
          data={[
            { value: '0', label: 'Only this message' },
            { value: '5', label: 'This + previous 5' },
            { value: '10', label: 'This + previous 10' },
            { value: '20', label: 'This + previous 20' },
          ]}
        />

        <Textarea
          label="Additional details (optional)"
          placeholder="Tell us what happened"
          value={details}
          onChange={(event) => onDetailsChange(event.currentTarget.value)}
          autosize
          minRows={3}
          maxLength={2000}
        />

        <Checkbox
          label="Block this phone number after reporting"
          checked={blockAfterReport}
          onChange={(event) =>
            onBlockAfterReportChange(event.currentTarget.checked)
          }
        />

        {message && (
          <Alert variant="light" title="Message being reported">
            <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
              {message.body || (message.mediaUrls?.length
                ? '[MMS attachment]'
                : '[No text]')}
            </Text>
          </Alert>
        )}

        <Text size="xs" c="dimmed">
          By submitting, you share this message, its sender's phone number,
          and any selected conversation context with Chatforia's moderation
          team. If you select Block, the sender's number will also be blocked.
        </Text>

        {error && (
          <Alert color="red" variant="light">
            {error}
          </Alert>
        )}

        <Group justify="flex-end">
          <Button variant="light" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button color="red" onClick={onSubmit} loading={submitting} disabled={submitting}>
            Submit report
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
