import fs from "fs/promises";
import path from "path";

const ROOT = path.resolve("../client/public/locales");
const SOURCE_LANG = "en";

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

async function readJsonSafe(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function flattenKeys(obj, prefix = "") {
  const keys = [];

  for (const [key, value] of Object.entries(obj || {})) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (isPlainObject(value)) {
      keys.push(...flattenKeys(value, fullKey));
    } else {
      keys.push(fullKey);
    }
  }

  return keys;
}

async function main() {
  const enFile = path.join(ROOT, SOURCE_LANG, "translation.json");
  const en = await readJsonSafe(enFile);

  if (!en) {
    console.error(`Could not read ${enFile}`);
    process.exit(1);
  }

  const enKeys = flattenKeys(en);

  console.log("\nGoogle fallback locale status:\n");

  for (const lang of Object.keys(GOOGLE_FALLBACK_LANGS)) {
  const targetFile = path.join(ROOT, lang, "translation.json");
  const target = await readJsonSafe(targetFile);

  if (!target) {
    console.log(`❌ ${lang}: missing or invalid translation.json`);
    continue;
  }

  const targetKeys = new Set(flattenKeys(target));
  const missing = enKeys.filter((key) => !targetKeys.has(key));

  if (missing.length === 0) {
    console.log(`✅ ${lang}: complete`);
  } else {
    console.log(`⚠️ ${lang}: ${missing.length} missing keys`);
  }
 }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});