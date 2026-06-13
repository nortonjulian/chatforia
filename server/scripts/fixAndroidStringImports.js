import fs from "fs";
import path from "path";

const ANDROID_SRC_DIR =
  "/Users/juliannorton/Chatforia/Users/juliannorton/Desktop/chatforia-android/app/src/main/java";

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    if (entry.isFile() && fullPath.endsWith(".kt")) return [fullPath];
    return [];
  });
}

function addImport(content, importLine) {
  if (content.includes(importLine)) return content;

  const lines = content.split("\n");
  const lastImportIndex = lines.reduce(
    (last, line, index) => line.startsWith("import ") ? index : last,
    -1
  );

  if (lastImportIndex === -1) return content;

  lines.splice(lastImportIndex + 1, 0, importLine);
  return lines.join("\n");
}

let changed = 0;

for (const file of walk(ANDROID_SRC_DIR)) {
  let content = fs.readFileSync(file, "utf8");
  const original = content;

  if (content.includes("stringResource(")) {
    content = addImport(
      content,
      "import androidx.compose.ui.res.stringResource"
    );
  }

  if (content.includes("R.string.")) {
    content = addImport(
      content,
      "import com.chatforia.android.R"
    );
  }

  if (content !== original) {
    fs.writeFileSync(file, content, "utf8");
    changed += 1;
    console.log(`✅ Fixed imports: ${file}`);
  }
}

console.log(`\nDone. Files changed: ${changed}`);