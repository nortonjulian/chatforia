// server/scripts/syncIosStrings.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WEB_LOCALES_DIR = path.resolve(
  __dirname,
  "../../client/public/locales"
);

const IOS_XCSTRINGS_PATH = path.resolve(
  __dirname,
  "../../../chatforia-ios/Chatforia/Chatforia/Localizable.xcstrings"
);

const SOURCE_FILE = "translation.json";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function flattenObject(obj, prefix = "") {
  return Object.entries(obj).reduce((acc, [key, value]) => {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(acc, flattenObject(value, fullKey));
    } else {
      acc[fullKey] = String(value);
    }

    return acc;
  }, {});
}

function localeToApple(locale) {
  const normalized = locale.replace("_", "-").toLowerCase();

  const map = {
    "zh-cn": "zh-Hans",
    "zh-tw": "zh-Hant",
    pt: "pt-BR",
    no: "nb",
    tl: "fil",
    fil: "fil",
    "mni-mtei": "mni",
    prs: "fa-AF",
  };

  return map[normalized] || normalized;
}

function main() {
  if (!fs.existsSync(IOS_XCSTRINGS_PATH)) {
    console.error(`❌ xcstrings not found: ${IOS_XCSTRINGS_PATH}`);
    process.exit(1);
  }

  const xcstrings = readJson(IOS_XCSTRINGS_PATH);

  if (!xcstrings.strings) {
    xcstrings.strings = {};
  }

  const localeDirs = fs
    .readdirSync(WEB_LOCALES_DIR)
    .filter((name) =>
      fs.statSync(path.join(WEB_LOCALES_DIR, name)).isDirectory()
    );

  for (const locale of localeDirs) {
    const appleLocale = localeToApple(locale);

    const localePath = path.join(
      WEB_LOCALES_DIR,
      locale,
      SOURCE_FILE
    );

    if (!fs.existsSync(localePath)) continue;

    const localeJson = readJson(localePath);
    const flat = flattenObject(localeJson);

    for (const [key, value] of Object.entries(flat)) {
      if (!xcstrings.strings[key]) {
        xcstrings.strings[key] = {
            extractionState: "manual",
            localizations: {}
        };
        }

        if (!xcstrings.strings[key].localizations) {
        xcstrings.strings[key].localizations = {};
        }

        xcstrings.strings[key].localizations[appleLocale] = {
        stringUnit: {
            state: "translated",
            value
        }
        };
    }

    console.log(`✅ Synced ${locale} → ${appleLocale}`);
  }

  fs.writeFileSync(
    IOS_XCSTRINGS_PATH,
    JSON.stringify(xcstrings, null, 2) + "\n"
  );

  console.log("\n🎉 iOS xcstrings sync complete.");
}

main();