import fs from "fs";
import path from "path";

const localeDir = "./public/locales";
const masterFile = "translation.json";
const backupFile = "translation.backup.json";

const master = JSON.parse(
  fs.readFileSync(path.join(localeDir, "en", masterFile), "utf8")
);

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizeObject(input) {
  if (Array.isArray(input)) {
    return input.reduce((merged, item) => {
      if (isPlainObject(item)) {
        return deepMerge(merged, item);
      }
      return merged;
    }, {});
  }

  return isPlainObject(input) ? input : {};
}

function deepMerge(target, source) {
  const out = { ...target };

  for (const [key, value] of Object.entries(source)) {
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = value;
    }
  }

  return out;
}

function repairAgainstMaster(masterNode, localeNode) {
  const repaired = {};

  for (const [key, masterValue] of Object.entries(masterNode)) {
    const localeValue = localeNode?.[key];

    if (isPlainObject(masterValue)) {
      repaired[key] = repairAgainstMaster(
        masterValue,
        isPlainObject(localeValue) ? localeValue : {}
      );
    } else {
      repaired[key] =
        typeof localeValue === "string" && localeValue.trim()
          ? localeValue
          : masterValue;
    }
  }

  return repaired;
}

const locales = fs
  .readdirSync(localeDir)
  .filter(locale => locale !== "en");

for (const locale of locales) {
  const localePath = path.join(localeDir, locale, masterFile);
  const backupPath = path.join(localeDir, locale, backupFile);

  if (!fs.existsSync(localePath)) {
    console.log(`Skipping ${locale}: missing translation.json`);
    continue;
  }

  try {
    const raw = fs.readFileSync(localePath, "utf8");
    const parsed = JSON.parse(raw);
    const normalized = normalizeObject(parsed);

    if (!fs.existsSync(backupPath)) {
      fs.writeFileSync(backupPath, raw);
    }

    const repaired = repairAgainstMaster(master, normalized);

    fs.writeFileSync(
      localePath,
      JSON.stringify(repaired, null, 2) + "\n"
    );

    console.log(`✓ Repaired ${locale}`);
  } catch (err) {
    console.log(`✗ Failed ${locale}: ${err.message}`);
  }
}

console.log("\nDone repairing locale structure.");