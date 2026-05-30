// server/scripts/translateMissingLocaleKeys.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";
import { translate } from "../utils/translationService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOCALES_DIR = path.resolve(__dirname, "../../client/public/locales");
const SOURCE_LANG = "en";
const SOURCE_FILE = "translation.json";

const missingReportPath = path.resolve(__dirname, "./missing-locale-keys.json");

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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

function getValue(obj, key) {
  if (Object.prototype.hasOwnProperty.call(obj, key)) {
    return obj[key];
  }

  return key.split(".").reduce((acc, part) => acc?.[part], obj);
}

function setNestedValue(obj, dottedKey, value) {
  const parts = dottedKey.split(".");
  let current = obj;

  for (const part of parts.slice(0, -1)) {
    if (!current[part] || typeof current[part] !== "object") {
      current[part] = {};
    }
    current = current[part];
  }

  current[parts.at(-1)] = value;
}

function toDeepLLangCode(lang) {
  const normalized = lang.toLowerCase();

  const map = {
    en: "EN-US",
    "en-us": "EN-US",
    "en-gb": "EN-GB",

    pt: "PT-PT",
    "pt-pt": "PT-PT",
    "pt-br": "PT-BR",

    nb: "NB",
    no: "NB",

    "zh-cn": "ZH-HANS",
    "zh-hans": "ZH-HANS",
    "zh-tw": "ZH-HANT",
    "zh-hant": "ZH-HANT",

    fil: "FIL",
    tl: "TL",

    bho: "BHO",
    prs: "PRS",
    kmr: "KMR",
    ckb: "CKB",
    yue: "YUE",
    gom: "GOM",
    mai: "MAI",
    pag: "PAG",

    "fr-ca": "FR-CA",
    "de-ch": "DE-CH",
    "es-419": "ES-419"
  };

  return map[normalized] || normalized.toUpperCase();
}

async function main() {
  if (!fs.existsSync(missingReportPath)) {
    console.error("❌ Missing report not found. Run:");
    console.error("node scripts/findMissingLocaleKeys.js");
    process.exit(1);
  }

  const sourcePath = path.join(LOCALES_DIR, SOURCE_LANG, SOURCE_FILE);
  const sourceJson = readJson(sourcePath);
  const missingReport = readJson(missingReportPath);

  for (const [lang, missingKeys] of Object.entries(missingReport)) {
    const targetPath = path.join(LOCALES_DIR, lang, SOURCE_FILE);

    if (!fs.existsSync(targetPath)) {
      console.warn(`⚠️ Skipping ${lang}: ${targetPath} not found`);
      continue;
    }

    const targetJson = readJson(targetPath);

    const isDeepLSupported =
      CHATFORIA_DEEPL_LANGS.has(lang.toLowerCase());

    if (!isDeepLSupported) {
      console.log(
        `⏭️ Skipping ${lang} — not DeepL-supported yet`
      );
      continue;
    }

    const deeplTargetLang = toDeepLLangCode(lang);

    console.log(`\n🌍 Translating ${missingKeys.length} keys for ${lang}...`);

    for (const key of missingKeys) {
      const englishText = getValue(sourceJson, key);

      if (typeof englishText !== "string" || !englishText.trim()) {
        console.warn(`⚠️ Skipping ${lang}.${key}: source value is not text`);
        continue;
      }

      try {
        const translatedText = await translate(englishText, deeplTargetLang, "EN");

        setNestedValue(targetJson, key, translatedText);
        console.log(`✅ ${lang}.${key}`);
      } catch (err) {
        console.error(`❌ Failed ${lang}.${key}:`, err.message);
      }
    }

    writeJson(targetPath, targetJson);
    console.log(`💾 Updated ${targetPath}`);
  }

  console.log("\n✅ Missing locale translation complete.");
}

main();