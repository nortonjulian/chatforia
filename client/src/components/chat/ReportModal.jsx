import {
  Modal,
  Stack,
  Select,
  Textarea,
  Checkbox,
  Alert,
  Group,
  Button,
  Text,
} from '@mantine/core';

export default function ReportModal({
  opened,
  onClose,
  target,
  reason,
  onReasonChange,
  details,
  onDetailsChange,
  contextCount,
  onContextCountChange,
  blockAfterReport,
  onBlockAfterReportChange,
  error,
  submitting,
  onSubmit,
  getBestPlaintextForReport,
}) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Report message"
      centered
      radius="lg"
    >
      <Stack>
        <Select
          label="Reason"
          value={reason}
          onChange={(value) => onReasonChange(value || 'harassment')}
          allowDeselect={false}
          data={[
            { value: 'harassment', label: 'Harassment' },
            { value: 'threats', label: 'Threats' },
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
          onChange={(value) => onContextCountChange(value || '10')}
          allowDeselect={false}
          data={[
            { value: '0', label: 'Only this message' },
            { value: '5', label: 'This + previous 5' },
            { value: '10', label: 'This + previous 10' },
            { value: '20', label: 'This + previous 20' },
          ]}
        />

        <Textarea
          label="Additional details"
          placeholder="Anything else moderators should know?"
          value={details}
          onChange={(e) => onDetailsChange(e.currentTarget.value)}
          autosize
          minRows={3}
        />

        <Checkbox
          label="Block this user after reporting"
          checked={blockAfterReport}
          onChange={(e) => onBlockAfterReportChange(e.currentTarget.checked)}
        />

        {target && (
          <Alert variant="light">
            <Text size="sm">
              Reporting message from{' '}
              <strong>{target.sender?.username || 'Unknown user'}</strong>
            </Text>
            <Text size="sm" mt={6}>
              {getBestPlaintextForReport(target) || '[No visible text]'}
            </Text>
          </Alert>
        )}

        {error && (
          <Alert color="red" variant="light">
            {error}
          </Alert>
        )}

        <Group justify="flex-end">
          <Button variant="light" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button color="red" onClick={onSubmit} loading={submitting}>
            Submit report
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}