import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXTRACTED_PATH = path.resolve(
  __dirname,
  "./android-extracted-strings.json"
);

const EN_TRANSLATION_PATH = path.resolve(
  __dirname,
  "../../client/public/locales/en/translation.json"
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function setNestedValue(obj, dottedKey, value) {
  const parts = dottedKey.split(".");
  let current = obj;

  for (const part of parts.slice(0, -1)) {
    if (
      !current[part] ||
      typeof current[part] !== "object" ||
      Array.isArray(current[part])
    ) {
      current[part] = {};
    }

    current = current[part];
  }

  const lastKey = parts[parts.length - 1];

  if (!Object.prototype.hasOwnProperty.call(current, lastKey)) {
    current[lastKey] = value;
    return true;
  }

  return false;
}

function main() {
  if (!fs.existsSync(EXTRACTED_PATH)) {
    console.error(`❌ Extracted Android strings not found: ${EXTRACTED_PATH}`);
    console.error("Run: node scripts/extractAndroidStrings.js");
    process.exit(1);
  }

  if (!fs.existsSync(EN_TRANSLATION_PATH)) {
    console.error(`❌ English translation file not found: ${EN_TRANSLATION_PATH}`);
    process.exit(1);
  }

  const extracted = readJson(EXTRACTED_PATH);
  const enJson = readJson(EN_TRANSLATION_PATH);

  let added = 0;
  let skipped = 0;

  for (const [key, value] of Object.entries(extracted)) {
    const didAdd = setNestedValue(enJson, key, value);

    if (didAdd) {
      added += 1;
    } else {
      skipped += 1;
    }
  }

  writeJson(EN_TRANSLATION_PATH, enJson);

  console.log("✅ Android strings merged into English locale:");
  console.log(EN_TRANSLATION_PATH);
  console.log(`Added: ${added}`);
  console.log(`Skipped existing: ${skipped}`);
}

main();