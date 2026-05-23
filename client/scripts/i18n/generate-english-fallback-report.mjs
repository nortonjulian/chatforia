// scripts/i18n/generate-english-fallback-report.mjs
import fs from "fs";
import path from "path";

const LOCALES_DIR = path.resolve("public/locales");
const REPORT_DIR = path.resolve("i18n-reports");
const REPORT_PATH = path.join(REPORT_DIR, "english-fallback-report.json");

const requestedLocale = process.argv[2];

const IGNORE_VALUES = new Set([
  "",
  "Chatforia",
  "Ria",
  "FOREA",
  "AI",
  "SMS",
  "MMS",
  "OK",
  "GIF",
  "GIFs",
  "Premium",
  "Plus",
  "Free",
  "eSIM",
  "ICCID",
  "MSISDN",
  "Wi-Fi",
  "Google",
  "Apple",
  "TikTok",
  "Instagram",
  "Facebook",
  "LinkedIn",
  "X"
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function flatten(obj, prefix = "", out = {}) {
  for (const [key, value] of Object.entries(obj || {})) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === "object" && !Array.isArray(value)) {
      flatten(value, fullKey, out);
    } else {
      out[fullKey] = value;
    }
  }

  return out;
}

function isProbablyTranslatable(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();

  if (!trimmed) return false;
  if (IGNORE_VALUES.has(trimmed)) return false;

  // Ignore pure numbers / symbols / placeholders.
  if (/^[\d\s%@$.,:+\-–—•#()]+$/.test(trimmed)) return false;

  // Ignore mostly placeholder-only strings.
  if (/^{{\s*[\w.]+\s*}}$/.test(trimmed)) return false;

  return true;
}

function main() {
  const enPath = path.join(LOCALES_DIR, "en", "translation.json");

  if (!fs.existsSync(enPath)) {
    throw new Error(`Missing English source file: ${enPath}`);
  }

  const enFlat = flatten(readJson(enPath));

  const localeDirs = fs
    .readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((locale) => locale !== "en")
    .filter((locale) => !requestedLocale || locale === requestedLocale)
    .sort();

  const report = {
    generatedAt: new Date().toISOString(),
    sourceLanguage: "en",
    scannedLocale: requestedLocale || null,
    summary: {
      localesScanned: 0,
      totalFallbacks: 0
    },
    locales: {}
  };

  for (const locale of localeDirs) {
    const localePath = path.join(LOCALES_DIR, locale, "translation.json");

    if (!fs.existsSync(localePath)) continue;

    const localeFlat = flatten(readJson(localePath));
    const fallbacks = {};

    for (const [key, englishValue] of Object.entries(enFlat)) {
      const localeValue = localeFlat[key];

      if (
        typeof englishValue === "string" &&
        typeof localeValue === "string" &&
        localeValue.trim() === englishValue.trim() &&
        isProbablyTranslatable(englishValue)
      ) {
        fallbacks[key] = englishValue;
      }
    }

    report.locales[locale] = {
      fallbackCount: Object.keys(fallbacks).length,
      keys: fallbacks
    };

    report.summary.localesScanned += 1;
    report.summary.totalFallbacks += Object.keys(fallbacks).length;
  }

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");

  console.log("✅ English fallback report generated");
  console.log(`📄 ${REPORT_PATH}`);
  console.log(`🌍 Locales scanned: ${report.summary.localesScanned}`);
  console.log(`🔁 Total English fallbacks: ${report.summary.totalFallbacks}`);

  if (requestedLocale && !report.locales[requestedLocale]) {
    console.warn(`⚠️ No locale found for: ${requestedLocale}`);
  }
}

main();