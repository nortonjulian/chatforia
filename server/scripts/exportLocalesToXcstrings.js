import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SITE_LOCALES_DIR = path.resolve(__dirname, "../../client/public/locales");
const XCSTRINGS_PATH =
  "/Users/juliannorton/Desktop/chatforia-ios/Chatforia/Chatforia/Localizable.xcstrings";

const langAliases = {
  "zh-cn": "zh-Hans",
  "zh-CN": "zh-Hans",
  "zh-tw": "zh-Hant",
  "zh-TW": "zh-Hant",
  no: "nb",
};

const langs = process.argv.slice(2);

function flatten(obj, prefix = "", out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === "object" && !Array.isArray(value)) {
      flatten(value, fullKey, out);
    } else {
      out[fullKey] = String(value ?? "");
    }
  }

  return out;
}

const catalog = JSON.parse(fs.readFileSync(XCSTRINGS_PATH, "utf8"));

catalog.sourceLanguage ||= "en";
catalog.strings ||= {};
catalog.version ||= "1.0";

for (const lang of langs) {
  const iosLang = langAliases[lang] ?? lang;
  const sourcePath = path.join(SITE_LOCALES_DIR, lang, "translation.json");

  if (!fs.existsSync(sourcePath)) {
    console.warn(`⚠️ Missing source: ${sourcePath}`);
    continue;
  }

  const flat = flatten(JSON.parse(fs.readFileSync(sourcePath, "utf8")));

  for (const [key, value] of Object.entries(flat)) {
    catalog.strings[key] ||= {};
    catalog.strings[key].localizations ||= {};

    catalog.strings[key].localizations[iosLang] = {
      stringUnit: {
        state: "translated",
        value,
      },
    };
  }

  console.log(`✅ Added ${lang} as ${iosLang} to Localizable.xcstrings`);
}

fs.writeFileSync(XCSTRINGS_PATH, JSON.stringify(catalog, null, 2) + "\n");
console.log(`💾 Updated ${XCSTRINGS_PATH}`);