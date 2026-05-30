import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";
import { translate } from "../utils/translationService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IOS_XCSTRINGS_PATH = path.resolve(
  __dirname,
  "../../../chatforia-ios/Chatforia/Chatforia/Localizable.xcstrings"
);

const SOURCE_LOCALE = "en";

const MAX_TRANSLATIONS_PER_RUN = Infinity;

const SKIP_LOCALES = new Set([
  SOURCE_LOCALE
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

const CHATFORIA_DEEPL_LANGS = new Set([
  "af", "sq", "ar", "hy", "as", "ay", "az", "eu", "be", "bn",
  "bho", "bs", "br", "bg", "my", "yue", "ca", "ceb",
  "zh-hans", "zh-hant", "hr", "cs", "da", "prs", "nl",
  "en", "en-us", "en-gb", "eo", "et", "fil", "fi", "fr",
  "fr-ca", "gl", "ka", "de", "de-ch", "el", "gn", "gu",
  "ht", "ha", "he", "hi", "is", "ig", "id", "ga", "it",
  "ja", "jv", "kk", "gom", "ko", "kmr", "ckb", "ky", "la",
  "ln", "lt", "lv", "lb", "mk", "mai", "mg", "ms", "ml",
  "mt", "mi", "mr", "mn", "ne", "nb", "oc", "om", "pag",
  "ps", "fa", "pl", "pt-pt", "pt-br", "pa", "qu", "ro",
  "ru", "sa", "sr", "st", "scn", "es", "es-419", "su",
  "sw", "sv", "tl", "tg", "ta", "tt", "te", "th", "ts",
  "tn", "tr", "tk", "uk", "ur", "uz", "vi", "cy", "wo",
  "xh", "yi", "zu"
]);

function appleLocaleToDeepL(locale) {
  const normalized = locale.replace("_", "-").toLowerCase();

  const map = {
    en: "EN-US",
    "en-us": "EN-US",
    "en-gb": "EN-GB",

    pt: "PT-PT",
    "pt-br": "PT-BR",
    "pt-pt": "PT-PT",

    zh: "ZH",
    "zh-hans": "ZH",
    "zh-cn": "ZH",
    "zh-hant": "ZH",
    "zh-tw": "ZH",

    fil: "TL",
    tl: "TL",

    no: "NB",
    nb: "NB",

    he: "HE",
    iw: "HE",

    id: "ID",
    in: "ID",

    fa: "FA",
    "fa-af": "FA",

    my: "MY",
    yue: "ZH"
  };

  return map[normalized] || normalized.toUpperCase();
}

function isProbablyUntranslated(value, englishValue, locale) {
  if (!value || !englishValue) return false;
  if (locale === SOURCE_LOCALE) return false;

  const cleanValue = String(value).trim();
  const cleanEnglish = String(englishValue).trim();

  if (!cleanValue || !cleanEnglish) return false;

  return cleanValue === cleanEnglish;
}

async function main() {
  if (!fs.existsSync(IOS_XCSTRINGS_PATH)) {
    console.error(`❌ xcstrings not found: ${IOS_XCSTRINGS_PATH}`);
    process.exit(1);
  }

  const xcstrings = readJson(IOS_XCSTRINGS_PATH);
  const strings = xcstrings.strings || {};

  let translatedCount = 0;

  for (const [key, entry] of Object.entries(strings)) {
    const localizations = entry.localizations || {};
    const englishValue =
      localizations[SOURCE_LOCALE]?.stringUnit?.value || key;

    if (!englishValue || !String(englishValue).trim()) continue;

    for (const [locale, localization] of Object.entries(localizations)) {
      if (SKIP_LOCALES.has(locale)) continue;

      const currentValue = localization?.stringUnit?.value;

      if (!isProbablyUntranslated(currentValue, englishValue, locale)) {
        continue;
      }

      if (translatedCount >= MAX_TRANSLATIONS_PER_RUN) {
        console.log(`\n⏸️ Hit MAX_TRANSLATIONS_PER_RUN=${MAX_TRANSLATIONS_PER_RUN}`);
        writeJson(IOS_XCSTRINGS_PATH, xcstrings);
        console.log(`💾 Saved partial progress to ${IOS_XCSTRINGS_PATH}`);
        return;
      }

      const deeplLang = appleLocaleToDeepL(locale);

      if (!DEEPL_SUPPORTED_TARGETS.has(deeplLang)) {
        continue;
    }

      try {
        const translatedText = await translate(
          englishValue,
          deeplLang,
          "EN"
        );

        localization.stringUnit.value = translatedText;
        localization.stringUnit.state = "translated";

        translatedCount += 1;

        if (translatedCount % 50 === 0) {
        writeJson(IOS_XCSTRINGS_PATH, xcstrings);
        console.log(`💾 Autosaved after ${translatedCount} translations`);
        }

        console.log(`✅ ${key} | ${locale}: ${englishValue} → ${translatedText}`);
      } catch (err) {
        console.warn(`⚠️ Skipped ${key} | ${locale} (${deeplLang}): ${err.message}`);
      }
    }
  }

  writeJson(IOS_XCSTRINGS_PATH, xcstrings);

  console.log(`\n🎉 iOS untranslated-string pass complete.`);
  console.log(`Translated values updated: ${translatedCount}`);
}

main();