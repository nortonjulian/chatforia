import { decryptMessageForUserBrowser } from './decryptionClient.js';

/**
 * Decrypt an array of fetched/socket messages for the current user.
 *
 * Supports both legacy and current server shapes:
 * - encryptedKeyForMe
 * - keys: [{ userId, encryptedKey }]
 * - encryptedKeys[currentUserId]
 * - sender.publicKey or senderPublicKeys[msg.sender.id]
 */
export async function decryptFetchedMessages(
  messages,
  currentUserPrivateKey,
  senderPublicKeys,
  currentUserId
) {
  return Promise.all(
    messages.map(async (msg) => {
      try {
        const numericUserId = Number(currentUserId);

        const encryptedKey =
          msg?.encryptedKeyForMe ??
          msg?.keys?.find((k) => Number(k?.userId) === numericUserId)?.encryptedKey ??
          msg?.encryptedKeys?.[numericUserId] ??
          msg?.encryptedKeys?.[String(numericUserId)] ??
          null;

        const senderId = Number(msg?.sender?.id);
        const senderPublicKey =
          msg?.sender?.publicKey ??
          senderPublicKeys?.[senderId] ??
          senderPublicKeys?.[String(senderId)] ??
          null;

        const ciphertext = msg?.contentCiphertext ?? null;

        // If the message is not encrypted, just pass it through.
        if (!ciphertext) {
          return {
            ...msg,
            decryptedContent:
              msg?.decryptedContent ??
              msg?.translatedForMe ??
              msg?.rawContent ??
              msg?.content ??
              '',
          };
        }

        if (!currentUserPrivateKey || !encryptedKey || !senderPublicKey) {
          throw new Error('Missing private key, encrypted key, or sender public key');
        }

        const decrypted = await decryptMessageForUserBrowser(
          ciphertext,
          encryptedKey,
          currentUserPrivateKey,
          senderPublicKey
        );

        return { ...msg, decryptedContent: decrypted };
      } catch (err) {
        console.warn(`Decryption failed for message ${msg?.id}:`, err);

        return {
          ...msg,
          decryptedContent:
            msg?.translatedForMe ??
            msg?.rawContent ??
            msg?.content ??
            '[Encrypted message]',
        };
      }
    })
  );
}