import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ANDROID_SRC_DIR =
  "/Users/juliannorton/Chatforia/Users/juliannorton/Desktop/chatforia-android/app/src/main/java";

const EXTRACTED_PATH = path.resolve(
  __dirname,
  "./android-extracted-strings.json"
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) return walk(fullPath);
    if (entry.isFile() && fullPath.endsWith(".kt")) return [fullPath];

    return [];
  });
}

function toAndroidResourceName(key) {
  return key.replace(/\./g, "_");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ensureStringResourceImport(content) {
  const needsStringResource =
    content.includes("stringResource(") &&
    !content.includes("androidx.compose.ui.res.stringResource");

  const needsAppR =
    content.includes("R.string.") &&
    !content.includes("import com.chatforia.android.R");

  if (!needsStringResource && !needsAppR) {
    return content;
  }

  const lines = content.split("\n");

  const lastImportIndex = lines.reduce((last, line, index) => {
    return line.startsWith("import ") ? index : last;
  }, -1);

  if (lastImportIndex === -1) {
    return content;
  }

  const importsToAdd = [];

  if (needsStringResource) {
    importsToAdd.push("import androidx.compose.ui.res.stringResource");
  }

  if (needsAppR) {
    importsToAdd.push("import com.chatforia.android.R");
  }

  lines.splice(
    lastImportIndex + 1,
    0,
    ...importsToAdd
  );

  return lines.join("\n");
}

function replaceLiteral(content, literal, resourceName) {
  const escaped = escapeRegex(literal);

  const replacements = [
    {
      from: new RegExp(`Text\\(\\s*"${escaped}"\\s*\\)`, "g"),
      to: `Text(stringResource(R.string.${resourceName}))`
    },
    {
      from: new RegExp(`text\\s*=\\s*"${escaped}"`, "g"),
      to: `text = stringResource(R.string.${resourceName})`
    },
    {
      from: new RegExp(`label\\s*=\\s*\\{\\s*Text\\(\\s*"${escaped}"\\s*\\)\\s*\\}`, "g"),
      to: `label = { Text(stringResource(R.string.${resourceName})) }`
    },
    {
      from: new RegExp(`placeholder\\s*=\\s*\\{\\s*Text\\(\\s*"${escaped}"\\s*\\)\\s*\\}`, "g"),
      to: `placeholder = { Text(stringResource(R.string.${resourceName})) }`
    },
    {
      from: new RegExp(`contentDescription\\s*=\\s*"${escaped}"`, "g"),
      to: `contentDescription = stringResource(R.string.${resourceName})`
    },
    {
      from: new RegExp(`title\\s*=\\s*"${escaped}"`, "g"),
      to: `title = stringResource(R.string.${resourceName})`
    },
    {
      from: new RegExp(`subtitle\\s*=\\s*"${escaped}"`, "g"),
      to: `subtitle = stringResource(R.string.${resourceName})`
    }
  ];

  let next = content;
  let count = 0;

  for (const replacement of replacements) {
    const before = next;
    next = next.replace(replacement.from, replacement.to);

    if (next !== before) {
      count += 1;
    }
  }

  return { content: next, count };
}

function main() {
  if (!fs.existsSync(ANDROID_SRC_DIR)) {
    console.error(`❌ Android source folder not found: ${ANDROID_SRC_DIR}`);
    process.exit(1);
  }

  if (!fs.existsSync(EXTRACTED_PATH)) {
    console.error(`❌ Extracted Android strings not found: ${EXTRACTED_PATH}`);
    console.error("Run: node scripts/extractAndroidStrings.js");
    process.exit(1);
  }

  const extracted = readJson(EXTRACTED_PATH);

  const entries = Object.entries(extracted)
    .sort((a, b) => b[1].length - a[1].length);

  const files = walk(ANDROID_SRC_DIR);

  let filesChanged = 0;
  let replacementsMade = 0;

  for (const file of files) {
    let content = fs.readFileSync(file, "utf8");
    const original = content;

    let fileReplacementCount = 0;

    for (const [key, literal] of entries) {
      const resourceName = toAndroidResourceName(key);

      const result = replaceLiteral(
        content,
        literal,
        resourceName
      );

      content = result.content;
      fileReplacementCount += result.count;
    }

    if (content !== original) {
      content = ensureStringResourceImport(content);
      fs.writeFileSync(file, content, "utf8");

      filesChanged += 1;
      replacementsMade += fileReplacementCount;

      console.log(`✅ Updated ${file}`);
    }
  }

  console.log("\n🎉 Android string replacement complete.");
  console.log(`Files scanned: ${files.length}`);
  console.log(`Files changed: ${filesChanged}`);
  console.log(`Replacement groups made: ${replacementsMade}`);
}

main();