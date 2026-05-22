import fs from "fs";
import path from "path";

const localeDir = "./public/locales";
const outDir = "./public/locales-untranslated";
const masterFile = "translation.json";

const master = JSON.parse(
  fs.readFileSync(
    path.join(localeDir, "en", masterFile),
    "utf8"
  )
);

function isObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

function extractUntranslated(masterNode, localeNode) {
  const out = {};

  for (const [key, masterValue] of Object.entries(masterNode)) {
    const localeValue = localeNode?.[key];

    if (isObject(masterValue)) {
      const child = extractUntranslated(
        masterValue,
        isObject(localeValue) ? localeValue : {}
      );

      if (Object.keys(child).length) {
        out[key] = child;
      }
    } else {
      if (
        typeof localeValue !== "string" ||
        localeValue === masterValue
      ) {
        out[key] = masterValue;
      }
    }
  }

  return out;
}

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const locales = fs
  .readdirSync(localeDir)
  .filter(locale => locale !== "en");

for (const locale of locales) {
  const localePath = path.join(
    localeDir,
    locale,
    masterFile
  );

  if (!fs.existsSync(localePath)) continue;

  try {
    const localeData = JSON.parse(
      fs.readFileSync(localePath, "utf8")
    );

    const untranslated = extractUntranslated(
      master,
      localeData
    );

    const outPath = path.join(
      outDir,
      `${locale}.untranslated.json`
    );

    fs.writeFileSync(
      outPath,
      JSON.stringify(untranslated, null, 2) + "\n"
    );

    console.log(`✓ ${locale}`);
  } catch (err) {
    console.log(`✗ ${locale}: ${err.message}`);
  }
}

console.log("\nDone exporting untranslated files.");