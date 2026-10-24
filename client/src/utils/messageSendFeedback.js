/** Only classify the backend's specific direct-block denial as an account block. */
export function isBlockedMessageSendError(error) {
  if (Number(error?.response?.status) !== 403) return false;
  const server = error?.response?.data || {};
  const description = [server.message, server.error, server.code]
    .filter((value) => typeof value === 'string')
    .join(' ');
  return /direct interaction unavailable/i.test(description);
}

export function messageSendFeedback(error) {
  if (isBlockedMessageSendError(error)) {
    return {
      title: 'Message not sent',
      message: 'Messaging is unavailable in this conversation while an account block is active.',
      color: 'orange',
    };
  }
  return {
    title: 'Message not sent',
    message: 'Your message could not be sent. Please try again.',
    color: 'red',
  };
}
