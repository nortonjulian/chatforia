import fs from "fs";
import path from "path";

const localesDir = path.resolve("public/locales");
const missingReportPath = path.resolve("i18n-reports/missing-key-report.json");

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

function setNested(obj, dottedKey, value) {
  const parts = dottedKey.split(".");
  let cur = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    cur[part] ||= {};
    cur = cur[part];
  }

  cur[parts[parts.length - 1]] = value;
}

const enPath = path.join(localesDir, "en", "translation.json");
const enFlat = flatten(JSON.parse(fs.readFileSync(enPath, "utf8")));
const missingReport = JSON.parse(fs.readFileSync(missingReportPath, "utf8"));

let filesUpdated = 0;
let keysAdded = 0;

for (const [locale, missingKeys] of Object.entries(missingReport)) {
  const filePath = path.join(localesDir, locale, "translation.json");
  if (!fs.existsSync(filePath)) continue;

  const json = JSON.parse(fs.readFileSync(filePath, "utf8"));
  let changed = false;

  for (const key of missingKeys) {
    if (!(key in enFlat)) continue;

    setNested(json, key, enFlat[key]);
    keysAdded++;
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(filePath, JSON.stringify(json, null, 2) + "\n");
    filesUpdated++;
  }
}

console.log("✅ Filled missing locale keys with English fallbacks");
console.log({ filesUpdated, keysAdded });