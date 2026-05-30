import fs from "fs/promises";
import path from "path";
import { Translate } from "@google-cloud/translate/build/src/v2/index.js";

const translate = new Translate();

const SOURCE_LANG = "en";
const ROOT = path.resolve("../client/public/locales");
const CHUNK_SIZE = 100;

const GOOGLE_FALLBACK_LANGS = {
  ak: "Akan",
  am: "Amharic",
  bm: "Bambara",
  co: "Corsican",
  dv: "Dhivehi",
  dz: "Dzongkha",
  fy: "Frisian",
  ff: "Fula",
  haw: "Hawaiian",
  hmn: "Hmong",
  ilo: "Iloko",
  kn: "Kannada",
  km: "Khmer",
  rw: "Kinyarwanda",
  kri: "Krio",
  lo: "Lao",
  lg: "Luganda",
  mni: "Meiteilon",
  "ar-MA": "Moroccan Arabic",
  nso: "Northern Sotho",
  or: "Odia",
  pap: "Papiamento",
  sm: "Samoan",
  gd: "Scots Gaelic",
  szl: "Silesian",
  sn: "Shona",
  sd: "Sindhi",
  si: "Sinhala",
  so: "Somali",
  ss: "Swati",
  tet: "Tetum",
  bo: "Tibetan",
  ti: "Tigrinya",
  tpi: "Tok Pisin",
  to: "Tongan",
  ug: "Uyghur",
  yo: "Yoruba",
};

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function collectStrings(obj, pathParts = [], entries = []) {
  if (typeof obj === "string") {
    if (obj.trim()) {
      entries.push({ pathParts, value: obj });
    }
    return entries;
  }

  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      collectStrings(item, [...pathParts, index], entries);
    });
    return entries;
  }

  if (isPlainObject(obj)) {
    for (const [key, value] of Object.entries(obj)) {
      collectStrings(value, [...pathParts, key], entries);
    }
  }

  return entries;
}

function setNestedValue(obj, pathParts, value) {
  let current = obj;

  for (const part of pathParts.slice(0, -1)) {
    current = current[part];
  }

  current[pathParts.at(-1)] = value;
}

async function translateChunk(values, targetLang) {
  const [translated] = await translate.translate(values, {
    from: "en",
    to: targetLang,
    format: "text",
  });

  return Array.isArray(translated) ? translated : [translated];
}

async function translateAllStrings(entries, targetLang) {
  const translatedEntries = [];

  for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
    const chunk = entries.slice(i, i + CHUNK_SIZE);
    const values = chunk.map((entry) => entry.value);

    console.log(
      `  Translating strings ${i + 1}-${Math.min(
        i + CHUNK_SIZE,
        entries.length
      )} of ${entries.length}...`
    );

    const translatedValues = await translateChunk(values, targetLang);

    chunk.forEach((entry, index) => {
      translatedEntries.push({
        pathParts: entry.pathParts,
        value: translatedValues[index],
      });
    });
  }

  return translatedEntries;
}

async function translateLocale(targetLang) {
  const sourceFile = path.join(ROOT, SOURCE_LANG, "translation.json");
  const targetDir = path.join(ROOT, targetLang);
  const targetFile = path.join(targetDir, "translation.json");

  const en = await readJson(sourceFile);
  const translatedJson = structuredClone(en);
  const entries = collectStrings(en);

  await fs.mkdir(targetDir, { recursive: true });

  console.log(`\nTranslating en → ${targetLang}...`);
  console.log(`  Found ${entries.length} strings.`);

  const translatedEntries = await translateAllStrings(entries, targetLang);

  for (const entry of translatedEntries) {
    setNestedValue(translatedJson, entry.pathParts, entry.value);
  }

  await fs.writeFile(
    targetFile,
    JSON.stringify(translatedJson, null, 2) + "\n"
  );

  console.log(`✓ Done: ${targetFile}`);
}

async function main() {
  const arg = process.argv[2];

  if (!arg) {
    console.error(
      "Usage:\n" +
        "node scripts/translateLocaleFileWithGoogle.js <lang>\n" +
        "node scripts/translateLocaleFileWithGoogle.js --all"
    );
    process.exit(1);
  }

  if (arg === "--all") {
    for (const lang of Object.keys(GOOGLE_FALLBACK_LANGS)) {
      try {
        await translateLocale(lang);
      } catch (err) {
        console.error(`✗ Failed ${lang}:`, err.message);
      }
    }

    console.log("\nAll batch translations complete.");
    return;
  }

  await translateLocale(arg);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});