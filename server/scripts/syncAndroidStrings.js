import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WEB_LOCALES_DIR = path.resolve(
  __dirname,
  "../../client/public/locales"
);

const ANDROID_RES_DIR =
  "/Users/juliannorton/Chatforia/Users/juliannorton/Desktop/chatforia-android/app/src/main/res";

const SOURCE_FILE = "translation.json";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function flattenObject(obj, prefix = "") {
  return Object.entries(obj).reduce((acc, [key, value]) => {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(acc, flattenObject(value, fullKey));
    } else {
      acc[fullKey] = String(value ?? "");
    }

    return acc;
  }, {});
}

function toAndroidKey(key) {
  return key
    .replace(/\./g, "_")
    .replace(/-/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^([0-9])/, "_$1");
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n");
}

function localeToAndroidValuesDir(locale) {
  const normalized = locale.toLowerCase();

  const map = {
    en: "values",
    "zh-cn": "values-zh-rCN",
    "zh-hans": "values-zh-rCN",
    "zh-tw": "values-zh-rTW",
    "zh-hant": "values-zh-rTW",
    "pt-br": "values-pt-rBR",
    "pt-pt": "values-pt-rPT",
    "fr-ca": "values-fr-rCA",
    "de-ch": "values-de-rCH",
    "es-419": "values-es-rUS",
    "ar-ma": "values-ar-rMA",   // ← ADD THIS
    no: "values-nb",
    fil: "values-tl",
    "mni-mtei": "values-mni",
    prs: "values-fa-rAF"
};

  if (map[normalized]) {
    return map[normalized];
  }

  return `values-${normalized.replace("_", "-")}`;
}

function buildStringsXml(flat) {
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<resources>"
  ];

  const seen = new Set();

  lines.push(`    <string name="app_name">Chatforia</string>`);
  seen.add("app_name");

  for (const [rawKey, rawValue] of Object.entries(flat).sort()) {
    const key = toAndroidKey(rawKey);

    if (seen.has(key)) {
      console.warn(`⚠️ Duplicate Android string key skipped: ${rawKey} → ${key}`);
      continue;
    }

    seen.add(key);

    lines.push(`    <string name="${key}">${escapeXml(rawValue)}</string>`);
  }

  lines.push("</resources>");
  lines.push("");

  return lines.join("\n");
}

function main() {
  if (!fs.existsSync(WEB_LOCALES_DIR)) {
    console.error(`❌ Web locales folder not found: ${WEB_LOCALES_DIR}`);
    process.exit(1);
  }

  if (!fs.existsSync(ANDROID_RES_DIR)) {
    console.error(`❌ Android res folder not found: ${ANDROID_RES_DIR}`);
    process.exit(1);
  }

  const localeDirs = fs
    .readdirSync(WEB_LOCALES_DIR)
    .filter((name) => {
      const localePath = path.join(WEB_LOCALES_DIR, name);
      return fs.statSync(localePath).isDirectory();
    });

  let syncedCount = 0;

  for (const locale of localeDirs) {
    const localeFile = path.join(
      WEB_LOCALES_DIR,
      locale,
      SOURCE_FILE
    );

    if (!fs.existsSync(localeFile)) {
      console.warn(`⚠️ Skipping ${locale}: missing translation.json`);
      continue;
    }

    const localeJson = readJson(localeFile);
    const flat = flattenObject(localeJson);

    const valuesDirName = localeToAndroidValuesDir(locale);
    const valuesDir = path.join(ANDROID_RES_DIR, valuesDirName);
    const outputPath = path.join(valuesDir, "strings.xml");

    fs.mkdirSync(valuesDir, { recursive: true });

    fs.writeFileSync(
      outputPath,
      buildStringsXml(flat),
      "utf8"
    );

    syncedCount += 1;

    console.log(`✅ Synced ${locale} → ${valuesDirName}/strings.xml`);
  }

  console.log(`\n🎉 Android strings sync complete. Locales synced: ${syncedCount}`);
}

main();