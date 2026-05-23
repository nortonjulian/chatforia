import fs from "fs";
import path from "path";

const locale = process.argv[2];
if (!locale) {
  console.error("Usage: node scripts/i18n/export-fallback-values-for-deepl.mjs af");
  process.exit(1);
}

const reportPath = path.resolve("i18n-reports/english-fallback-report.json");
const outDir = path.resolve("i18n-reports/deepl-batches", locale);

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const keys = report.locales?.[locale]?.keys || {};

fs.mkdirSync(outDir, { recursive: true });

const entries = Object.entries(keys);
const batchSize = 100;

for (let i = 0; i < entries.length; i += batchSize) {
  const batch = entries.slice(i, i + batchSize);

  const values = batch.map(([, value]) => value).join("\n");
  const keyMap = Object.fromEntries(batch.map(([key], index) => [index + 1, key]));

  const batchNumber = String(i / batchSize + 1).padStart(3, "0");

  fs.writeFileSync(path.join(outDir, `batch-${batchNumber}-values.txt`), values + "\n");
  fs.writeFileSync(path.join(outDir, `batch-${batchNumber}-keys.json`), JSON.stringify(keyMap, null, 2) + "\n");
}

console.log(`✅ Exported ${entries.length} fallback values for ${locale}`);
console.log(`📁 ${outDir}`);