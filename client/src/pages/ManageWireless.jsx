import { useTranslation } from 'react-i18next';
import PortNumberForm from '../components/wireless/PortNumberForm.jsx';
import PortRequestsList from '../components/wireless/PortRequestsList.jsx';

export default function ManageWirelessPage() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-4">
      {/* Header */}
      <section>
        <h1 className="text-xl font-bold">
          {t('wireless.title', 'Chatforia Wireless')}
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          {t(
            'wireless.description',
            'Manage your Chatforia mobile plan, numbers, forwarding, and number porting.'
          )}
        </p>
      </section>

      {/* Explain options */}
      <section className="rounded-lg border p-4">
        <h2 className="text-lg font-semibold">
          {t('wireless.options.heading', 'Choose how you want to use Chatforia')}
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          {t(
            'wireless.options.subheading',
            'You can get a new Chatforia number, or bring your existing number from another carrier.'
          )}
        </p>
        <ul className="mt-2 text-sm list-disc list-inside text-gray-700">
          <li>
            {t('wireless.options.newNumber', 'Get a new Chatforia number')}
          </li>
          <li>
            {t(
              'wireless.options.portNumber',
              'Port your current number into Chatforia Wireless'
            )}
          </li>
        </ul>
      </section>

      {/* 🔑 Actual port form */}
      <section id="port-number" className="rounded-lg border p-4">
        <h2 className="text-lg font-semibold">
          {t('wireless.port.heading', 'Port your existing number')}
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          {t(
            'wireless.port.subheading',
            'Move your current phone number from your existing carrier into Chatforia. Make sure the details match your carrier account exactly to avoid delays.'
          )}
        </p>
        <div className="mt-4">
          <PortNumberForm />
        </div>
      </section>

      {/* Porting status list */}
      <section className="rounded-lg border p-4">
        <h2 className="text-lg font-semibold">
          {t('wireless.status.heading', 'Porting status')}
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          {t(
            'wireless.status.subheading',
            'Track the status of your number port requests.'
          )}
        </p>
        <div className="mt-4">
          <PortRequestsList />
        </div>
      </section>
    </div>
  );
}
