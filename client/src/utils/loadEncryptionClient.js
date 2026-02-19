let _modulePromise = null;

/**
 * Dynamically import the encryption client and cache the promise.
 * Returns the module namespace object (with named exports).
 *
 * Usage:
 *   const mod = await loadEncryptionClient();
 *   const { encryptForRoom, decryptFetchedMessages } = mod;
 */
export default function loadEncryptionClient() {
  if (_modulePromise) return _modulePromise;
  _modulePromise = import(/* webpackChunkName: "encryption-client" */ '@/utils/encryptionClient.js');
  return _modulePromise;
}
