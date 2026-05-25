import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOCALES_DIR = path.resolve(__dirname, "../../client/public/locales");
const SOURCE_LANG = "en";
const SOURCE_FILE = "translation.json";

const CHATFORIA_DEEPL_LANGS = new Set([
  "af", "sq", "ar", "hy", "az", "eu", "be", "bn", "bg", "my",
  "ca", "zh-cn", "zh-tw", "hr", "cs", "da", "nl", "en",
  "et", "fil", "fi", "fr", "gl", "ka", "de", "el", "gu",
  "he", "hi", "hu", "id", "it", "ja", "jv", "kk", "ko",
  "ky", "la", "lv", "lt", "lb", "mk", "ms", "ml", "mt",
  "mr", "mn", "ne", "no", "fa", "pl", "pt", "pa", "ro",
  "ru", "sr", "sk", "sl", "es", "sv", "ta", "te", "th",
  "tr", "uk", "ur", "uz", "vi", "cy", "zu"
]);

const PROTECTED_SAME_AS_ENGLISH_VALUES = new Set([
  "Chatforia",
  "Ria",
  "AI",
  "SMS",
  "MMS",
  "GIF",
  "Plus",
  "Premium",
  "Free",
  "Google",
  "Apple",
  "iPhone",
  "Android",
  "eSIM",
  "US",
  "UK",
  "EU",
  "CA",
  "AU",
  "JP"
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function flattenObject(obj, prefix = "") {
  return Object.entries(obj).reduce((acc, [key, value]) => {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(acc, flattenObject(value, fullKey));
    } else {
      acc[fullKey] = value;
    }

    return acc;
  }, {});
}

function normalizeComparableValue(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function isProtectedSameAsEnglishValue(value) {
  return PROTECTED_SAME_AS_ENGLISH_VALUES.has(
    normalizeComparableValue(value)
  );
}

function isProbablyNonTranslatable(value) {
  const text = normalizeComparableValue(value);

  if (!text) return false;

  // Pure symbols, punctuation, numbers, percentages, emoji-ish short tokens.
  if (!/[A-Za-z]/.test(text)) return true;

  // Common technical / UI constants that should not force translation.
  if (/^[A-Z0-9+._#%-]{1,12}$/.test(text)) return true;

  // Phone-number-looking examples.
  if (/^\+?\d[\d\s().-]*$/.test(text)) return true;

  return false;
}

function isMissingOrEnglishFallback({ key, sourceFlat, targetFlat, lang }) {
  const sourceValue = normalizeComparableValue(sourceFlat[key]);
  const targetHasKey = Object.prototype.hasOwnProperty.call(targetFlat, key);
  const targetValue = normalizeComparableValue(targetFlat[key]);

  if (!targetHasKey) return true;
  if (!targetValue) return true;

  if (!sourceValue) return false;

  const shouldTranslateLang = CHATFORIA_DEEPL_LANGS.has(lang.toLowerCase());

  if (
    shouldTranslateLang &&
    targetValue === sourceValue &&
    !isProtectedSameAsEnglishValue(sourceValue) &&
    !isProbablyNonTranslatable(sourceValue)
  ) {
    return true;
  }

  return false;
}

function main() {
  if (!fs.existsSync(LOCALES_DIR)) {
    console.error(`❌ Locale folder not found: ${LOCALES_DIR}`);
    process.exit(1);
  }

  const sourcePath = path.join(LOCALES_DIR, SOURCE_LANG, SOURCE_FILE);

  if (!fs.existsSync(sourcePath)) {
    console.error(`❌ Source locale not found: ${sourcePath}`);
    process.exit(1);
  }

  const langDirs = fs
    .readdirSync(LOCALES_DIR)
    .filter((name) =>
      fs.statSync(path.join(LOCALES_DIR, name)).isDirectory()
    );

  const sourceFlat = flattenObject(readJson(sourcePath));
  const sourceKeys = Object.keys(sourceFlat);

  const report = {};

  for (const lang of langDirs) {
    if (lang === SOURCE_LANG) continue;

    const targetPath = path.join(LOCALES_DIR, lang, SOURCE_FILE);

    if (!fs.existsSync(targetPath)) {
      report[lang] = sourceKeys;
      continue;
    }

    const targetFlat = flattenObject(readJson(targetPath));

    const missingKeys = sourceKeys.filter((key) =>
      isMissingOrEnglishFallback({
        key,
        sourceFlat,
        targetFlat,
        lang
      })
    );

    if (missingKeys.length > 0) {
      report[lang] = missingKeys;
    }
  }

  const outputPath = path.resolve(__dirname, "./missing-locale-keys.json");

  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n");

  console.log("✅ Missing locale key report created:");
  console.log(outputPath);
  console.log(`Languages with missing/fallback keys: ${Object.keys(report).length}`);
}

main();