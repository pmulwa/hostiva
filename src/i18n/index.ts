import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import de from './locales/de.json';
import pt from './locales/pt.json';
import zh from './locales/zh.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import ar from './locales/ar.json';
import it from './locales/it.json';
import hi from './locales/hi.json';
import ru from './locales/ru.json';

export const languages = [
  { code: 'en', name: 'English', flag: '🇺🇸', region: 'United States' },
  { code: 'es', name: 'Español', flag: '🇪🇸', region: 'España' },
  { code: 'fr', name: 'Français', flag: '🇫🇷', region: 'France' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪', region: 'Deutschland' },
  { code: 'pt', name: 'Português', flag: '🇧🇷', region: 'Brasil' },
  { code: 'it', name: 'Italiano', flag: '🇮🇹', region: 'Italia' },
  { code: 'zh', name: '中文', flag: '🇨🇳', region: '中国' },
  { code: 'ja', name: '日本語', flag: '🇯🇵', region: '日本' },
  { code: 'ko', name: '한국어', flag: '🇰🇷', region: '대한민국' },
  { code: 'ar', name: 'العربية', flag: '🇸🇦', region: 'السعودية' },
  { code: 'hi', name: 'हिन्दी', flag: '🇮🇳', region: 'भारत' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺', region: 'Россия' },
];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
      fr: { translation: fr },
      de: { translation: de },
      pt: { translation: pt },
      zh: { translation: zh },
      ja: { translation: ja },
      ko: { translation: ko },
      ar: { translation: ar },
      it: { translation: it },
      hi: { translation: hi },
      ru: { translation: ru },
    },
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  });

export default i18n;
