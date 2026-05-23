import fs from "fs";
import path from "path";

const localesDir = path.resolve("public/locales");
const outputPath = path.resolve("i18n-reports/missing-key-report.json");

function flatten(obj, prefix = "", out = {}) {
  for (const [key, value] of Object.entries(obj || {})) {
    const nextKey = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === "object" && !Array.isArray(value)) {
      flatten(value, nextKey, out);
    } else {
      out[nextKey] = value;
    }
  }

  return out;
}

const enPath = path.join(localesDir, "en", "translation.json");
const en = flatten(JSON.parse(fs.readFileSync(enPath, "utf8")));

const report = {};

for (const dirent of fs.readdirSync(localesDir, { withFileTypes: true })) {
  if (!dirent.isDirectory() || dirent.name === "en") continue;

  const locale = dirent.name;
  const filePath = path.join(localesDir, locale, "translation.json");

  if (!fs.existsSync(filePath)) continue;

  const localeJson = flatten(JSON.parse(fs.readFileSync(filePath, "utf8")));
  const missing = Object.keys(en).filter((key) => !(key in localeJson));

  if (missing.length > 0) {
    report[locale] = missing;
  }
}

fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n");

console.log("✅ Missing key report created:");
console.log(outputPath);
console.log({
  localesWithMissingKeys: Object.keys(report).length,
});