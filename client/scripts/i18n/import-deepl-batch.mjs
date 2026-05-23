import fs from "fs";
import path from "path";

const locale = process.argv[2];
const batchNumberRaw = process.argv[3];

if (!locale || !batchNumberRaw) {
  console.error("Usage: node scripts/i18n/import-deepl-batch.mjs af 001");
  process.exit(1);
}

const batchNumber = String(batchNumberRaw).padStart(3, "0");

const localePath = path.resolve("public/locales", locale, "translation.json");
const batchDir = path.resolve("i18n-reports/deepl-batches", locale);
const keysPath = path.join(batchDir, `batch-${batchNumber}-keys.json`);
const valuesPath = path.join(batchDir, `batch-${batchNumber}-values.txt`);
const translatedPath = path.join(batchDir, `batch-${batchNumber}-translated.txt`);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function setNestedValue(obj, dotKey, value) {
  const parts = dotKey.split(".");
  let current = obj;

  for (const part of parts.slice(0, -1)) {
    if (!current[part] || typeof current[part] !== "object" || Array.isArray(current[part])) {
      current[part] = {};
    }
    current = current[part];
  }

  current[parts.at(-1)] = value;
}

if (!fs.existsSync(localePath)) {
  throw new Error(`Missing locale file: ${localePath}`);
}

if (!fs.existsSync(keysPath)) {
  throw new Error(`Missing keys file: ${keysPath}`);
}

if (!fs.existsSync(translatedPath)) {
  throw new Error(`Missing translated file: ${translatedPath}`);
}

const localeJson = readJson(localePath);
const keyMap = readJson(keysPath);

const translatedLines = fs
  .readFileSync(translatedPath, "utf8")
  .split(/\r?\n/);

// Remove only one final blank line if present.
if (translatedLines.at(-1) === "") {
  translatedLines.pop();
}

const orderedKeys = Object.keys(keyMap)
  .sort((a, b) => Number(a) - Number(b))
  .map((index) => keyMap[index]);

const valuesLines = fs
  .readFileSync(valuesPath, "utf8")
  .split(/\r?\n/);

if (valuesLines.at(-1) === "") {
  valuesLines.pop();
}

const expectedCount = valuesLines.length;

if (translatedLines.length !== expectedCount) {
  console.error(`❌ Line count mismatch for ${locale} batch ${batchNumber}`);
  console.error(`Expected: ${expectedCount}`);
  console.error(`Actual:   ${translatedLines.length}`);
  console.error("Fix the translated file before importing.");
  process.exit(1);
}

let updated = 0;

for (let i = 0; i < translatedLines.length; i++) {
  const key = orderedKeys[i];
  const value = translatedLines[i];

  if (!key) {
    throw new Error(`Missing key for line ${i + 1}`);
  }

  setNestedValue(localeJson, key, value);
  updated += 1;
}

fs.writeFileSync(localePath, JSON.stringify(localeJson, null, 2) + "\n");

console.log(`✅ Imported DeepL batch ${batchNumber} for ${locale}`);
console.log(`🌍 Updated locale: ${locale}`);
console.log(`🔑 Updated keys: ${updated}`);
console.log(`📄 ${localePath}`);
