import { useEffect, useState } from 'react';
import axiosClient from '../api/axiosClient';
import { useUser } from '../context/UserContext';
import { generateKeypair, loadKeysLocal, saveKeysLocal } from '../utils/keys';
import { migrateLocalToIDBIfNeeded } from '../utils/keyStore';
import KeySetupModal from './KeySetupModal';

import { fetchRemoteKeyBackup } from '@/utils/keyBackupRemote';

export default function BootstrapUser() {
  const { currentUser, setCurrentUser } = useUser();
  const [askedThisSession, setAskedThisSession] = useState(false);
  const [keyModalOpen, setKeyModalOpen] = useState(false);
  const [haveServerPubKey, setHaveServerPubKey] = useState(false);

  // Restore user from localStorage if context empty
  useEffect(() => {
    if (!currentUser) {
      const saved = localStorage.getItem('user');
      if (saved) {
        try {
          setCurrentUser(JSON.parse(saved));
        } catch {}
      }
    }
  }, [currentUser, setCurrentUser]);

  useEffect(() => {
    const handler = () => {
      setCurrentUser(null);
      window.location.href = '/';
    };
    window.addEventListener('auth-logout', handler);
    return () => window.removeEventListener('auth-logout', handler);
  }, [setCurrentUser]);

  // Migrate any legacy localStorage keys → IndexedDB (one-time)
  useEffect(() => {
    migrateLocalToIDBIfNeeded().catch(() => {});
  }, []);

  // Ensure keys exist on this device, prompt only if missing
    useEffect(() => {
    (async () => {
      if (!currentUser || askedThisSession) return;

      const localKeys = await loadKeysLocal();
      const localPub = localKeys?.publicKey || null;
      const localPriv = localKeys?.privateKey || null;
      const serverPub = currentUser.publicKey || null;

      const localMatchesServer =
        !!localPub && !!serverPub && localPub === serverPub;

      if (localPriv && localMatchesServer) {
        return;
      }

      setAskedThisSession(true);

      let remoteKeys = null;
      try {
        remoteKeys = await fetchRemoteKeyBackup();
      } catch (e) {
        console.warn('Failed to inspect remote key backup', e?.message || e);
      }

      const remotePub = remoteKeys?.publicKey || null;
      const serverHasPub = Boolean(remotePub || serverPub);
      const serverHasBackup = Boolean(remoteKeys?.encryptedPrivateKeyBundle);

      setHaveServerPubKey(serverHasPub);

      console.log('[BootstrapUser] key state', {
        serverPub,
        localPub,
        localHasPrivateKey: !!localPriv,
        localMatchesServer,
        remotePub,
        serverHasBackup,
      });

      // Local keys exist but do NOT match server identity.
      if (localPriv && !localMatchesServer) {
        console.warn('[BootstrapUser] local key mismatch with server public key');
        setKeyModalOpen(true);
        return;
      }

      // No server key yet: create one on this device.
      if (!serverHasPub) {
        try {
          const kp = generateKeypair();
          await saveKeysLocal(kp);
          await axiosClient.post('/users/keys', { publicKey: kp.publicKey });

          setCurrentUser((prev) => ({ ...prev, publicKey: kp.publicKey }));
          localStorage.setItem(
            'user',
            JSON.stringify({ ...currentUser, publicKey: kp.publicKey })
          );
        } catch (e) {
          console.error('Public key upload failed', e);
          setKeyModalOpen(true);
        }
        return;
      }

      // Only show recovery UI when a real backup exists.
      if (serverHasBackup) {
        setKeyModalOpen(true);
        return;
      }

      // Server has only a public key and this device has no private key.
      // Do not block fresh users here.
      return;
    })();
  }, [currentUser, askedThisSession, setCurrentUser]);

  return (
    <>
      <KeySetupModal
        opened={keyModalOpen}
        haveServerPubKey={haveServerPubKey}
        onClose={() => setKeyModalOpen(false)}
      />
      {null}
    </>
  );
}
