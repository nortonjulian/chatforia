import fs from "fs";
import path from "path";

const siteLocalesDir = path.resolve("public/locales");
const iosXcstringsPath = path.resolve(
  "../../chatforia-ios/Chatforia/Chatforia/Localizable.xcstrings"
);

function flatten(obj, prefix = "", out = {}) {
  for (const [key, value] of Object.entries(obj || {})) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      flatten(value, nextKey, out);
    } else if (typeof value === "string") {
      out[nextKey] = value;
    }
  }
  return out;
}

if (!fs.existsSync(iosXcstringsPath)) {
  console.error(`Missing iOS xcstrings file: ${iosXcstringsPath}`);
  process.exit(1);
}

const xc = JSON.parse(fs.readFileSync(iosXcstringsPath, "utf8"));
xc.strings ||= {};

const localeDirs = fs
  .readdirSync(siteLocalesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

let updated = 0;
let skipped = 0;

for (const locale of localeDirs) {
  const translationPath = path.join(siteLocalesDir, locale, "translation.json");

  if (!fs.existsSync(translationPath)) continue;

  const webJson = JSON.parse(fs.readFileSync(translationPath, "utf8"));
  const flat = flatten(webJson);

  for (const [key, translatedValue] of Object.entries(flat)) {
    if (!xc.strings[key]) {
      skipped++;
      continue;
    }

    xc.strings[key].localizations ||= {};
    xc.strings[key].localizations[locale] = {
      stringUnit: {
        state: "translated",
        value: translatedValue,
      },
    };

    updated++;
  }
}

fs.writeFileSync(iosXcstringsPath, JSON.stringify(xc, null, 2) + "\n");

console.log("✅ Synced website locales into iOS Localizable.xcstrings");
console.log({ locales: localeDirs.length, updated, skipped });