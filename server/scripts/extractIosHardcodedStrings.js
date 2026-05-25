import fs from "fs";
import path from "path";

const IOS_REPORT_PATH = path.resolve(
  "../../chatforia-ios/hardcoded-ios.txt"
);

const OUTPUT_PATH = path.resolve(
  "./scripts/ios-hardcoded-strings.json"
);

function isLocalizationKey(value) {
  return /^[a-z0-9_.-]+$/i.test(value)
    && value.includes(".");
}

function shouldSkip(value) {
  return (
    value.startsWith("Chatforia/") ||
    value.includes(".swift:") ||
    value === "Text(" ||
    value === "title:" ||
    value === "subtitle:" ||
    value === "s" ||
    isLocalizationKey(value)
  );
}

function main() {
  const raw = fs.readFileSync(IOS_REPORT_PATH, "utf8");

  const matches = [
    ...raw.matchAll(/"([^"]+)"/g)
  ]
    .map(m => m[1].trim())
    .filter(Boolean)
    .filter(v => !shouldSkip(v));

  const unique = [...new Set(matches)].sort();

  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(unique, null, 2) + "\n"
  );

  console.log(
    `✅ Extracted ${unique.length} REAL hardcoded iOS strings`
  );
}

main();