import fs from "fs";
import path from "path";

const localeDir = "./public/locales";
const masterFile = "translation.json";
const backupFile = "translation.backup.json";

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

function leaf(pathName) {
  return pathName.split(".").at(-1);
}

function normalizeKeyName(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function backupLooksTranslated(value, englishValue) {
  return (
    typeof value === "string" &&
    value.trim() &&
    value !== englishValue
  );
}

const locales = fs
  .readdirSync(localeDir)
  .filter(locale => locale !== "en");

let grandTotal = 0;

for (const locale of locales) {
  const livePath = path.join(localeDir, locale, masterFile);
  const backupPath = path.join(localeDir, locale, backupFile);

  if (!fs.existsSync(livePath) || !fs.existsSync(backupPath)) continue;

  const live = JSON.parse(fs.readFileSync(livePath, "utf8"));
  const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));

  const masterFlat = flatten(master);
  const liveFlat = flatten(live);
  const backupFlat = flatten(backup);

  let restored = 0;

  for (const [keyPath, englishValue] of Object.entries(masterFlat)) {
    const liveValue = liveFlat[keyPath];

    if (liveValue !== englishValue) continue;

    // 1. Exact key-path match first.
    const exactBackupValue = backupFlat[keyPath];

    if (backupLooksTranslated(exactBackupValue, englishValue)) {
      setByPath(live, keyPath, exactBackupValue);
      restored++;
      continue;
    }

    // 2. Safer same-section + same-leaf match.
    const section = keyPath.split(".")[0];
    const keyLeaf = normalizeKeyName(leaf(keyPath));

    const candidates = Object.entries(backupFlat).filter(
      ([backupPathName, backupValue]) => {
        const sameSection =
          backupPathName.split(".")[0] === section;

        const sameLeaf =
          normalizeKeyName(leaf(backupPathName)) === keyLeaf;

        return (
          sameSection &&
          sameLeaf &&
          backupLooksTranslated(backupValue, englishValue)
        );
      }
    );

    if (candidates.length === 1) {
      setByPath(live, keyPath, candidates[0][1]);
      restored++;
    }
  }

  fs.writeFileSync(
    livePath,
    JSON.stringify(live, null, 2) + "\n"
  );

  grandTotal += restored;
  console.log(`✓ ${locale}: smart-restored ${restored}`);
}

console.log(`\nDone. Smart-restored ${grandTotal} values.`);