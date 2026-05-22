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

function restoreFromBackup(masterNode, liveNode, backupNode) {
  const restored = { ...liveNode };
  let count = 0;

  for (const [key, masterValue] of Object.entries(masterNode)) {
    const liveValue = liveNode?.[key];
    const backupValue = backupNode?.[key];

    if (isPlainObject(masterValue)) {
      const result = restoreFromBackup(
        masterValue,
        isPlainObject(liveValue) ? liveValue : {},
        isPlainObject(backupValue) ? backupValue : {}
      );

      restored[key] = result.restored;
      count += result.count;
    } else {
      const liveIsEnglishFallback = liveValue === masterValue;
      const backupHasTranslation =
        typeof backupValue === "string" &&
        backupValue.trim() &&
        backupValue !== masterValue;

      if (liveIsEnglishFallback && backupHasTranslation) {
        restored[key] = backupValue;
        count++;
      }
    }
  }

  return { restored, count };
}

const locales = fs
  .readdirSync(localeDir)
  .filter(locale => locale !== "en");

let totalRestored = 0;

for (const locale of locales) {
  const livePath = path.join(localeDir, locale, masterFile);
  const backupPath = path.join(localeDir, locale, backupFile);

  if (!fs.existsSync(livePath) || !fs.existsSync(backupPath)) {
    continue;
  }

  try {
    const live = JSON.parse(fs.readFileSync(livePath, "utf8"));
    const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));

    const { restored, count } = restoreFromBackup(master, live, backup);

    fs.writeFileSync(
      livePath,
      JSON.stringify(restored, null, 2) + "\n"
    );

    totalRestored += count;
    console.log(`✓ ${locale}: restored ${count} translated values`);
  } catch (err) {
    console.log(`✗ ${locale}: ${err.message}`);
  }
}

console.log(`\nDone. Restored ${totalRestored} translated values from backups.`);