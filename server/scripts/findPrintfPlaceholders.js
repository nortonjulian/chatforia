import fs from "fs";
import path from "path";

const LOCALES_DIR = path.resolve("../client/public/locales");
const PATTERN = /%@|%d|%i|%f|%s/g;

function walk(obj, prefix = "", hits = []) {
  for (const [key, value] of Object.entries(obj || {})) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === "object" && !Array.isArray(value)) {
      walk(value, fullKey, hits);
    } else if (typeof value === "string" && PATTERN.test(value)) {
      hits.push({ key: fullKey, value });
    }

    PATTERN.lastIndex = 0;
  }

  return hits;
}

for (const lang of fs.readdirSync(LOCALES_DIR)) {
  const file = path.join(LOCALES_DIR, lang, "translation.json");
  if (!fs.existsSync(file)) continue;

  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  const hits = walk(json);

  if (hits.length) {
    console.log(`\n${lang}: ${hits.length}`);
    for (const hit of hits) {
      console.log(`  ${hit.key}: ${hit.value}`);
    }
  }
}