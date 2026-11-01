import axiosClient from './axiosClient';

export async function submitSmsMessageReport(messageId, options) {
  if (!Number.isSafeInteger(Number(messageId)) || Number(messageId) <= 0) {
    throw new Error('Valid SMS message ID required.');
  }

  const { data } = await axiosClient.post(
    `/sms/messages/${messageId}/report`,
    {
      reason: options.reason,
      details: options.details,
      contextCount: options.contextCount,
      blockAfterReport: options.blockAfterReport === true,
    }
  );

  if (!data?.success || !data?.report?.id) {
    throw new Error('The server did not confirm your report.');
  }

  return data.report;
}
