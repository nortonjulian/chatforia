import fs from "fs";
import path from "path";

const localeDir = "./public/locales";
const outDir = "./public/locales-untranslated-flat";
const masterFile = "translation.json";

const master = JSON.parse(
  fs.readFileSync(path.join(localeDir, "en", masterFile), "utf8")
);

function isObj(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

function flatten(obj, prefix = "", out = {}) {
  for (const [key, value] of Object.entries(obj || {})) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (isObj(value)) {
      flatten(value, fullKey, out);
    } else if (typeof value === "string") {
      out[fullKey] = value;
    }
  }

  return out;
}

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

for (const locale of fs.readdirSync(localeDir)) {
  if (locale === "en") continue;

  const localePath = path.join(localeDir, locale, masterFile);
  if (!fs.existsSync(localePath)) continue;

  const localeData = JSON.parse(fs.readFileSync(localePath, "utf8"));

  const masterFlat = flatten(master);
  const localeFlat = flatten(localeData);

  const untranslated = {};

  for (const [key, englishValue] of Object.entries(masterFlat)) {
    if (localeFlat[key] === englishValue) {
      untranslated[key] = englishValue;
    }
  }

  fs.writeFileSync(
    path.join(outDir, `${locale}.flat.json`),
    JSON.stringify(untranslated, null, 2) + "\n"
  );

  console.log(`✓ ${locale}: ${Object.keys(untranslated).length}`);
}

console.log("\nDone exporting flat untranslated files.");