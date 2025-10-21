import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axiosClient from '@/api/axiosClient';

export default function SmsThreadPage() {
  const { threadId } = useParams();
  const [thread, setThread] = useState(null);
  const [text, setText] = useState('');

  useEffect(() => {
    axiosClient.get(`/sms/threads/${threadId}`)
      .then(res => setThread(res.data))
      .catch(() => setThread(null));
  }, [threadId]);

  const send = async () => {
    const to = thread?.contactPhone;
    if (!to || !text.trim()) return;
    await axiosClient.post('/sms/send', { to, body: text });
    setText('');
    const fresh = await axiosClient.get(`/sms/threads/${threadId}`);
    setThread(fresh.data);
  };

  if (!thread) return null;

  return (
    <div className="sms-thread">
      <div className="sms-messages">
        {(thread.messages || []).map(m => (
          <div key={m.id} className={m.direction === 'out' ? 'msg out' : 'msg in'}>
            {m.body}
          </div>
        ))}
      </div>

      <div className="sms-composer">
        <input
          placeholder="Type a message…"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
        />
        <button onClick={send}>Send</button>
      </div>
    </div>
  );
}
