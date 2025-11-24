import { useTranslation } from 'react-i18next';
import VoicemailList from '../components/voicemail/VoicemailList.jsx';

export default function VoicemailPage() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col h-full">
      <header className="px-4 py-2 border-b border-gray-200 flex items-center justify-between">
        <h1 className="text-base font-semibold">
          {t('voicemail.pageTitle')}
        </h1>
      </header>

      <main className="flex-1 min-h-0">
        <VoicemailList />
      </main>
    </div>
  );
}
