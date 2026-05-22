import fs from "fs";
import path from "path";

const [translatedFile, locale] = process.argv.slice(2);

if (!translatedFile || !locale) {
  console.log(
    "Usage: node scripts/importFlatTranslated.js <translated-flat-file> <locale>"
  );
  process.exit(1);
}

const localeDir = "./public/locales";
const masterFile = "translation.json";

const livePath = path.join(localeDir, locale, masterFile);

if (!fs.existsSync(livePath)) {
  console.error(`Missing live locale file: ${livePath}`);
  process.exit(1);
}

if (!fs.existsSync(translatedFile)) {
  console.error(`Missing translated file: ${translatedFile}`);
  process.exit(1);
}

function normalizeDeepLText(text) {
  return text
    .replace(/\u060C/g, ",") // Persian/Arabic comma
    .replace(/\u061B/g, ";") // Persian/Arabic semicolon
    .replace(/\u061F/g, "?"); // Persian/Arabic question mark
}

function setByPath(obj, dottedPath, value) {
  const parts = dottedPath.split(".");
  let cur = obj;

  for (const part of parts.slice(0, -1)) {
    if (
      !(part in cur) ||
      typeof cur[part] !== "object" ||
      cur[part] === null ||
      Array.isArray(cur[part])
    ) {
      cur[part] = {};
    }

    cur = cur[part];
  }

  cur[parts.at(-1)] = value;
}

function extractFlatPairs(raw) {
  const pairs = [];

  const linePattern =
    /^\s*"([A-Za-z0-9_.-]+)"\s*:\s*"((?:\\.|[^"\\])*)"\s*,?\s*$/;

  for (const line of raw.split("\n")) {
    const normalized = normalizeDeepLText(line);
    const match = normalized.match(linePattern);

    if (!match) continue;

    const [, key, rawValue] = match;

    try {
      const value = JSON.parse(`"${rawValue}"`);
      pairs.push([key, value]);
    } catch {
      // Skip malformed lines safely.
    }
  }

  return pairs;
}

const live = JSON.parse(fs.readFileSync(livePath, "utf8"));
const raw = fs.readFileSync(translatedFile, "utf8");
const pairs = extractFlatPairs(raw);

let imported = 0;

for (const [key, value] of pairs) {
  if (
    typeof value === "string" &&
    value.trim() &&
    !/[A-Za-z]{4,}/.test(value)
  ) {
    setByPath(live, key, value);
    imported++;
  } else if (
    typeof value === "string" &&
    value.trim()
  ) {
    // Still import mixed values if they contain Persian characters.
    if (/[آ-ی]/.test(value)) {
      setByPath(live, key, value);
      imported++;
    }
  }
}

fs.writeFileSync(livePath, JSON.stringify(live, null, 2) + "\n");

console.log(`✓ Imported ${imported} translated values into ${locale}`);