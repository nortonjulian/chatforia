import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import HttpBackend from 'i18next-http-backend';

// No SUPPORTED_LNGS import — accept whatever exists under /public/locales

i18n
  .use(HttpBackend)                 // load translations over HTTP
  .use(LanguageDetector)            // detect user language
  .use(initReactI18next)
  .init({
    // Allow any language that has a /locales/<lng>/translation.json
    supportedLngs: false,           // no hardcoded list; accept all
    nonExplicitSupportedLngs: true, // map es-MX -> es, pt-BR -> pt, etc.
    load: 'languageOnly',           // coerce en-US -> en
    fallbackLng: 'en',              // default to English if nothing is set

    interpolation: { escapeValue: false },
    react: { useSuspense: false },  // avoid suspense boundaries for HTTP loading

    detection: {
      // IMPORTANT: do NOT look at the browser or <html lang> by default,
      // so first-time users fall back to English unless they already chose a language.
      order: ['localStorage', 'cookie', 'querystring'],
      caches: ['localStorage', 'cookie'],
      lookupLocalStorage: 'i18nextLng',
      lookupCookie: 'i18nextLng',
    },

    backend: {
      // Served from client/public
      loadPath: '/locales/{{lng}}',
      // optional cache-buster if you set a version env
      queryStringParams: { v: import.meta.env?.VITE_APP_VERSION || '' },
    },

    returnNull: false,
    debug: false,
  });

export default i18n;
