const fs = require("fs");
const path = require("path");

// Detect whether we're at repo root (has client/src) or inside client/
const cwd = process.cwd();
const isAtRepoRoot = fs.existsSync(path.join(cwd, "client", "src"));
const base = isAtRepoRoot ? path.join(cwd, "client") : cwd;

const roots = [
  "src/components",
  "src/context",
  "src/features",
  "src/lib",
  "src/messages",
  "src/pages",
].map((p) => path.join(base, p));

const testRoots = [
  path.join(base, "__tests__"),
  path.join(base, "src", "__tests__"), // in case you place tests here, too
];

const ignoreNames = new Set([
  "index.js", "index.jsx", "index.ts", "index.tsx",
  "types.ts", "types.d.ts",
]);

// OPTIONAL: de-prioritize certain static areas (comment out if you want everything)
const IGNORE_REGEX = /\/pages\/legal\/|\/components\/footer\//;

function listFiles(dir, exts = [".jsx", ".tsx", ".ts"]) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue; // skip any tests folder entirely
      out.push(...listFiles(full, exts));       // RECURSE ✅
      continue;
    }

    // Skip test files by name (defensive) and trivial/ignored files
    if (/\.test\.(ts|jsx|tsx)$/.test(entry.name)) continue;
    if (exts.includes(path.extname(entry.name)) && !ignoreNames.has(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function allTestFiles() {
  return testRoots.flatMap((tr) => listFiles(tr, [".ts", ".jsx", ".tsx"]));
}

function hasTestFor(baseName, testFiles) {
  // Match "X.test.js" / "X.test.ts" / "X.test.jsx" / "X.test.tsx"
  const re = new RegExp(`^${baseName.replace(/\./g, "\\.")}\\.test\\.(ts|jsx|tsx)$`);
  return testFiles.some((f) => re.test(path.basename(f)));
}

const files = roots.flatMap((r) => listFiles(r));
const tests = allTestFiles();

const untested = [];
for (const file of files) {
  if (IGNORE_REGEX.test(file)) continue; // optional filter

  const baseName = path.basename(file).replace(/\.(jsx|tsx|ts)$/, "");
  if (baseName.endsWith(".module")) continue; // skip CSS modules, etc.

  if (!hasTestFor(baseName, tests)) {
    // store paths relative to repo `client/` for readability
    untested.push(path.relative(isAtRepoRoot ? path.join(cwd, "client") : base, file));
  }
}

if (untested.length === 0) {
  console.log("✅ All candidate files have matching tests (by filename heuristic).");
} else {
  console.log("Files without a matching *.test.js/ts/tsx/jsx:");
  for (const f of untested) console.log(" -", f);
  // Uncomment to fail CI if desired:
  // process.exitCode = 1;
}
