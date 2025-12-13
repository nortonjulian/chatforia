import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import HttpBackend from 'i18next-http-backend';

// Single-file setup: we only load /locales/<lng>/translation.json
// All feature areas (e.g., "auth") live under objects inside that file, like "auth": { ... }

i18n
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    supportedLngs: false,
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
    fallbackLng: 'en',
    defaultNS: 'translation',

    interpolation: { escapeValue: false },
    react: { useSuspense: false },

    detection: {
      // Priority:
      // 1) ?lng=xx in the URL
      // 2) previously chosen language (localStorage / cookie)
      // 3) browser language (navigator)
      order: ['querystring', 'localStorage', 'cookie', 'navigator'],

      caches: ['localStorage', 'cookie'],

      lookupQuerystring: 'lng',
      lookupLocalStorage: 'i18nextLng',
      lookupCookie: 'i18nextLng',
    },


    backend: {
      loadPath: '/locales/{{lng}}/translation.json',
      queryStringParams: { v: import.meta.env?.VITE_APP_VERSION || Date.now() },
    },

    returnNull: false,
    debug: false,
  });

// Extra guard: if URL has ?lng=, force it immediately (covers edge cases)
try {
  const urlLng = new URLSearchParams(window.location.search).get('lng');
  if (urlLng && i18n.language !== urlLng) i18n.changeLanguage(urlLng);
} catch {}

if (import.meta.env.MODE !== 'production') {
  window.i18n = i18n;
}

export default i18n;
