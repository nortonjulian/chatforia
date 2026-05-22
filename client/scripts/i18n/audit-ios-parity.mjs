import fs from "fs";

const webPath = "public/locales/en/translation.json";
const iosPath = "/Users/juliannorton/Desktop/chatforia-ios/Chatforia/Chatforia/Localizable.xcstrings";

function flatten(obj, prefix = "", out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === "object" && !Array.isArray(value)) {
      flatten(value, fullKey, out);
    } else {
      out[fullKey] = String(value);
    }
  }

  return out;
}

function getIosEnglishValue(entry, fallbackKey) {
  return (
    entry?.localizations?.en?.stringUnit?.value ??
    fallbackKey
  );
}

const web = JSON.parse(fs.readFileSync(webPath, "utf8"));
const ios = JSON.parse(fs.readFileSync(iosPath, "utf8"));

const flatWeb = flatten(web);
const iosStrings = ios.strings ?? {};

const webByValue = new Map();

for (const [key, value] of Object.entries(flatWeb)) {
  const normalized = value.trim().toLowerCase();
  if (!webByValue.has(normalized)) webByValue.set(normalized, []);
  webByValue.get(normalized).push(key);
}

const SOFT_MATCHES = [];
const exactMatches = [];
const missingFromWeb = [];
const rawEnglishKeys = [];

const IGNORE_PATTERNS = [
  /^[0-9]+$/,
  /^[•—+\-]+$/,
  /^%[@a-zA-Z0-9$%]+$/,
  /^\+?[0-9]{5,}$/,
  /^[0-9+–\- ]+$/
];

for (const [iosKey, entry] of Object.entries(iosStrings)) {
  if (!iosKey.trim()) continue;

  const iosValue = getIosEnglishValue(entry, iosKey);

  if (IGNORE_PATTERNS.some((r) => r.test(iosValue.trim()))) {
  continue;
}
  const normalizedValue = iosValue.trim().toLowerCase();

  const partialMatches = Object.entries(flatWeb)
  .filter(([_, webValue]) => {
    const w = webValue.trim().toLowerCase();

    return (
      w.includes(normalizedValue) ||
      normalizedValue.includes(w)
    );
  })
  .slice(0, 5);

  const webMatches = webByValue.get(normalizedValue);

  if (webMatches?.length) {
    exactMatches.push({
        iosKey,
        iosValue,
        webKeys: webMatches
    });
    }
    else if (partialMatches.length) {
    SOFT_MATCHES.push({
        iosKey,
        iosValue,
        suggestions: partialMatches.map(([k]) => k)
    });
    }
    else {
    missingFromWeb.push({
        iosKey,
        iosValue
    });
    }

  if (iosKey === iosValue || iosKey.includes(" ")) {
    rawEnglishKeys.push({
      iosKey,
      iosValue
    });
  }
}

const report = {
  summary: {
  webKeyCount: Object.keys(flatWeb).length,
  iosKeyCount: Object.keys(iosStrings).length,
  exactValueMatches: exactMatches.length,
  softMatches: SOFT_MATCHES.length,
  missingFromWeb: missingFromWeb.length,
  rawEnglishStyleKeys: rawEnglishKeys.length
},
exactMatches,
softMatches: SOFT_MATCHES,
missingFromWeb,
rawEnglishKeys
};

fs.mkdirSync("i18n-reports", { recursive: true });
fs.writeFileSync(
  "i18n-reports/ios-web-parity-report.json",
  JSON.stringify(report, null, 2)
);

console.log("✅ iOS/Web parity report created:");
console.log("i18n-reports/ios-web-parity-report.json");
console.log(report.summary);