import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import '@mantine/core/styles.css';

import UserProfile from '../components/UserProfile.jsx';
import { UserContext } from '../context/UserContext.jsx';

function QARoot() {
  const [currentUser, setCurrentUser] = useState(null);
  const [account, setAccount] = useState('A');

  async function loadAccount(nextAccount) {
    const response = await fetch(`/qa/voicemail-account?account=${nextAccount}`);
    if (!response.ok) throw new Error('Synthetic account response unavailable');
    setCurrentUser(await response.json());
    setAccount(nextAccount);
  }

  useEffect(() => { void loadAccount('A'); }, []);
  window.qaSwitchVoicemailAccount = loadAccount;

  return <MantineProvider><MemoryRouter><UserContext.Provider value={{ currentUser, setCurrentUser }}>
    <div style={{ maxWidth: 700, margin: '2rem auto' }}>
      <p data-testid="qa-voicemail-account">Synthetic account {account}</p>
      {currentUser && <UserProfile qaVoicemailOnly />}
    </div>
  </UserContext.Provider></MemoryRouter></MantineProvider>;
}

createRoot(document.getElementById('root')).render(<QARoot />);
