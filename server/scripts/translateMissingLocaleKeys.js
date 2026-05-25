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
  "af","sq","ar","hy","az","eu","be","bn","bg","my",
  "ca","zh-cn","zh-tw","hr","cs","da","nl","en",
  "et","fil","fi","fr","gl","ka","de","el","gu",
  "he","hi","hu","id","it","ja","jv","kk","ko",
  "ky","la","lv","lt","lb","mk","ms","ml","mt",
  "mr","mn","ne","no","fa","pl","pt","pa","ro",
  "ru","sr","sk","sl","es","sv","ta","te","th",
  "tr","uk","ur","uz","vi","cy","zu"
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

function getNestedValue(obj, dottedKey) {
  return dottedKey.split(".").reduce((acc, key) => acc?.[key], obj);
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

    pt: "PT-BR",

    no: "NB",
    nb: "NB",

    "zh-cn": "ZH",
    "zh-tw": "ZH",

    fil: "TL",
    tl: "TL",
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

    const useEnglishFallback = !CHATFORIA_DEEPL_LANGS.has(lang.toLowerCase());

    if (useEnglishFallback) {
      console.log(
        `↩️ ${lang} is not in Chatforia+DeepL intersection — using English fallback`
      );
    }

    const deeplTargetLang = toDeepLLangCode(lang);

    console.log(`\n🌍 Translating ${missingKeys.length} keys for ${lang}...`);

    for (const key of missingKeys) {
      const englishText = getNestedValue(sourceJson, key);

      if (typeof englishText !== "string" || !englishText.trim()) {
        console.warn(`⚠️ Skipping ${lang}.${key}: source value is not text`);
        continue;
      }

      try {
        const translatedText = useEnglishFallback
          ? englishText
          : await translate(englishText, deeplTargetLang, "EN");

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