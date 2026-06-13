import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ANDROID_SRC_DIR = "/Users/juliannorton/Chatforia/Users/juliannorton/Desktop/chatforia-android/app/src/main/java";

const OUTPUT_PATH = path.resolve(
  __dirname,
  "./android-extracted-strings.json"
);

const IGNORE_VALUES = new Set([
  "",
  " ",
  "FREE",
  "PLUS",
  "PREMIUM",
  "WIRELESS",
  "GIF",
  "SMS",
  "MMS",
  "AI",
  "Ria",
  "Chatforia",
  "Google",
  "Apple"
]);

function walk(dir) {
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      return walk(fullPath);
    }

    if (entry.isFile() && fullPath.endsWith(".kt")) {
      return [fullPath];
    }

    return [];
  });
}

function isProbablyUserFacing(value) {
  const text = value.trim();

  if (!text) return false;
  if (IGNORE_VALUES.has(text)) return false;

  // Skip Kotlin string interpolation fragments.
  if (text.includes("$") || text.includes("${")) return false;

  if (text.length === 1 && !/[A-Za-z]/.test(text)) return false;

  if (/^https?:\/\//i.test(text)) return false;
  if (/^mailto:/i.test(text)) return false;
  if (/^[A-Z0-9_./:-]+$/.test(text)) return false;
  if (/^\+?\d[\d\s().-]*$/.test(text)) return false;
  if (/^\$?\d+(\.\d+)?$/.test(text)) return false;
  if (/^\{\{.*\}\}$/.test(text)) return false;

  return /[A-Za-z]/.test(text);
}

function cleanValue(value) {
  return value
    .replace(/\\"/g, "\"")
    .replace(/\\n/g, "\n")
    .trim();
}

function baseNameFromFile(filePath) {
  return path
    .basename(filePath, ".kt")
    .replace(/Screen|View|Sheet|Dialog/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/chatforia/g, "")
    .replace(/ria/g, "ria")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function makeKey(filePath, value, existingKeys) {
  const fileBase = baseNameFromFile(filePath);
  const slug = slugify(value) || "text";

  let key = `android.${fileBase}.${slug}`;

  let index = 2;
  while (existingKeys.has(key)) {
    key = `android.${fileBase}.${slug}_${index}`;
    index += 1;
  }

  existingKeys.add(key);

  return key;
}

function extractFromContent(content) {
  const results = [];

  const patterns = [
    /Text\s*\(\s*"((?:\\"|[^"])*)"/g,
    /text\s*=\s*"((?:\\"|[^"])*)"/g,
    /label\s*=\s*\{\s*Text\s*\(\s*"((?:\\"|[^"])*)"/g,
    /placeholder\s*=\s*\{\s*Text\s*\(\s*"((?:\\"|[^"])*)"/g,
    /contentDescription\s*=\s*"((?:\\"|[^"])*)"/g,
    /title\s*=\s*"((?:\\"|[^"])*)"/g,
    /subtitle\s*=\s*"((?:\\"|[^"])*)"/g
  ];

  for (const pattern of patterns) {
    let match;

    while ((match = pattern.exec(content)) !== null) {
      const value = cleanValue(match[1]);

      if (isProbablyUserFacing(value)) {
        results.push(value);
      }
    }
  }

  return results;
}

function main() {
  if (!fs.existsSync(ANDROID_SRC_DIR)) {
    console.error(`❌ Android source folder not found: ${ANDROID_SRC_DIR}`);
    process.exit(1);
  }

  const files = walk(ANDROID_SRC_DIR);

  const output = {};
  const seenValues = new Map();
  const existingKeys = new Set();

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    const values = extractFromContent(content);

    for (const value of values) {
      const normalized = value.trim();

      if (seenValues.has(normalized)) {
        continue;
      }

      const key = makeKey(file, normalized, existingKeys);

      seenValues.set(normalized, key);
      output[key] = normalized;
    }
  }

  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(output, null, 2) + "\n",
    "utf8"
  );

  console.log("✅ Android strings extracted:");
  console.log(OUTPUT_PATH);
  console.log(`Files scanned: ${files.length}`);
  console.log(`Strings extracted: ${Object.keys(output).length}`);
}

main();