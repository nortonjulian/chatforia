import fs from "fs";
import path from "path";

const localeDir = "./public/locales";
const masterFile = "translation.json";
const sourceDir = "./src";

const master = JSON.parse(
  fs.readFileSync(
    path.join(localeDir, "en", masterFile),
    "utf8"
  )
);

function flatten(obj, prefix = "") {
  let result = {};

  for (const key in obj) {
    const newKey = prefix
      ? `${prefix}.${key}`
      : key;

    if (
      typeof obj[key] === "object" &&
      obj[key] !== null
    ) {
      Object.assign(
        result,
        flatten(obj[key], newKey)
      );
    } else {
      result[newKey] = obj[key];
    }
  }

  return result;
}

const masterKeys = flatten(master);

const ignoredCodeKeys = new Set([
  "accessibilitySettings.${k}",
  "esim.regions.${r}",
  "support.quickTopics.${value}",
]);

//
// ADD THIS WHOLE BLOCK HERE
//

function getAllFiles(dir, files = []) {
  for (const item of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      getAllFiles(fullPath, files);
    } else if (
  /\.(js|jsx|ts|tsx)$/.test(fullPath) &&
  !fullPath.includes(".test.") &&
  !fullPath.includes(".spec.") &&
  !fullPath.includes("__tests__")
) {
  files.push(fullPath);
}
  }

  return files;
}

function extractUsedKeys() {
  const files = getAllFiles(sourceDir);
  const usedKeys = new Set();

  const patterns = [
  /t\(\s*["'`]([^"'`]+)["'`]/g,
  /i18n\.t\(\s*["'`]([^"'`]+)["'`]/g,
  /i18nKey=["'`]([^"'`]+)["'`]/g,
  /tKey=["'`]([^"'`]+)["'`]/g,
  /translationKey=["'`]([^"'`]+)["'`]/g,
];

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");

    for (const pattern of patterns) {
      let match;

      while ((match = pattern.exec(content)) !== null) {
        const key = match[1];

        const looksLikeI18nKey =
          /^[a-zA-Z][a-zA-Z0-9_-]*(\.[a-zA-Z0-9_${}-]+)+$/.test(key);

        if (looksLikeI18nKey) {
          usedKeys.add(key);
        }
      }
    }
  }

  return [...usedKeys].sort();
}

const usedKeys = extractUsedKeys();

const missingFromEnglish = usedKeys.filter(
  key => !(key in masterKeys) && !ignoredCodeKeys.has(key)
);

if (missingFromEnglish.length) {
  console.log(
    "\n=== Keys used in code but missing from en/translation.json ==="
  );

  missingFromEnglish.forEach(key =>
    console.log(`  ✗ ${key}`)
  );
}

console.log(`\n=== Code Scan Summary ===`);
console.log(`Used keys found in code: ${usedKeys.length}`);
console.log(`Missing from English: ${missingFromEnglish.length}`);

//
// KEEP THE REST OF YOUR EXISTING CODE
//

const locales = fs.readdirSync(localeDir);

const localeStats = [];
const missingKeyCounts = {};
const untranslatedStats = [];

for (const locale of locales) {
  if (locale === "en") continue;

  const localePath = path.join(localeDir, locale, masterFile);

  if (!fs.existsSync(localePath)) {
    console.log(`\n${locale}`);
    console.log(`  ✗ Missing translation.json`);

    localeStats.push({
      locale,
      total: Object.keys(masterKeys).length,
      missing: Object.keys(masterKeys).length,
      coverage: 0,
    });

    continue;
  }

  const localeData = JSON.parse(fs.readFileSync(localePath, "utf8"));
  const localeKeys = flatten(localeData);

  const untranslated = [];

function compareUntranslated(masterNode, localeNode, prefix = "") {
  for (const key in masterNode) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (
      typeof masterNode[key] === "object" &&
      masterNode[key] !== null
    ) {
      compareUntranslated(masterNode[key], localeNode?.[key] || {}, path);
    } else {
      if (localeNode?.[key] === masterNode[key]) {
        untranslated.push(path);
      }
    }
  }
}

compareUntranslated(master, localeData);

untranslatedStats.push({
  locale,
  untranslated: untranslated.length,
  total: Object.keys(masterKeys).length,
  translatedCoverage:
    ((Object.keys(masterKeys).length - untranslated.length) /
      Object.keys(masterKeys).length) *
    100,
});

if (untranslated.length) {
  console.log(`\n${locale} untranslated English fallbacks`);
  untranslated.slice(0, 25).forEach(k => console.log(`  ⚠ ${k}`));

  if (untranslated.length > 25) {
    console.log(`  ...and ${untranslated.length - 25} more`);
  }
}

  const missing = Object.keys(masterKeys).filter(k => !(k in localeKeys));

  missing.forEach(key => {
    missingKeyCounts[key] = (missingKeyCounts[key] || 0) + 1;
  });

  const total = Object.keys(masterKeys).length;
  const coverage = ((total - missing.length) / total) * 100;

  localeStats.push({
    locale,
    total,
    missing: missing.length,
    coverage,
  });

  if (missing.length) {
    console.log(`\n${locale}`);
    missing.forEach(k => console.log(`  ✗ ${k}`));
  }
}

console.log("\n=== Locale Coverage Summary ===");

localeStats
  .sort((a, b) => a.coverage - b.coverage)
  .forEach(stat => {
    console.log(
      `${stat.locale}: ${stat.coverage.toFixed(1)}% complete (${stat.missing}/${stat.total} missing)`
    );
  });

console.log("\n=== Translation Coverage Summary ===");

untranslatedStats
  .sort((a, b) => a.translatedCoverage - b.translatedCoverage)
  .forEach(stat => {
    console.log(
      `${stat.locale}: ${stat.translatedCoverage.toFixed(1)}% translated (${stat.untranslated}/${stat.total} English fallbacks)`
    );
  });

console.log("\n=== Top 20 Most Missing Keys Across Locales ===");

Object.entries(missingKeyCounts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20)
  .forEach(([key, count]) => {
    console.log(`${key}: missing in ${count} locales`);
  });

console.log("\n✓ Locale check complete.");