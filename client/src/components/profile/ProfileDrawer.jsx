import { useNavigate } from 'react-router-dom';

function EsimEntry() {
  const nav = useNavigate();
  const onClick = () => nav('/account/esim');

  return (
    <div className="p-3 rounded-lg border bg-white/60">
      <div className="font-medium mb-1">Chatforia eSIM</div>
      <p className="text-sm text-gray-600">
        Get mobile data for Chatforia when you’re away from Wi-Fi.
      </p>
      <button
        onClick={onClick}
        className="mt-2 px-3 py-1.5 rounded bg-black text-white"
      >
        Get eSIM / Show QR
      </button>
    </div>
  );
}
