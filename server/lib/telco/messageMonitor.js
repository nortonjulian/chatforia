import logger from '../../utils/logger.js';
import prisma from '../../utils/prismaClient.js';

/**
 * Handles a Twilio delivery status callback.
 * Called by /webhooks/status
 */
export async function handleStatusUpdate(payload) {
  const {
    MessageSid,
    MessageStatus,
    To,
    From,
    ErrorCode,
    ErrorMessage,
    SmsSid,
    SmsStatus,
  } = payload;

  const sid = MessageSid || SmsSid;
  const status = MessageStatus || SmsStatus;

  logger.info(
    { sid, To, From, status, ErrorCode, ErrorMessage },
    '[Twilio Status Update]'
  );

  // Example: store status in DB (optional — adjust to your schema)
  try {
    await prisma.outboundMessage.updateMany({
      where: { providerMessageId: sid },
      data: {
        deliveryStatus: status,
        deliveryErrorCode: ErrorCode || null,
        deliveryErrorMessage: ErrorMessage || null,
        deliveryUpdatedAt: new Date(),
      },
    });
  } catch (err) {
    logger.warn({ err, sid }, 'Failed to persist delivery status');
  }
}
