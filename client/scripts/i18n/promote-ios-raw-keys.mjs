import fs from "fs";
import path from "path";

const reportPath = path.resolve("i18n-reports/ios-web-parity-report.json");

if (!fs.existsSync(reportPath)) {
  console.error("Run audit-ios-parity.mjs first.");
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));

const SKIP = [
  /^%@/,
  /^🔒/,
  /^AI$/,
  /^All$/,
  /^Auto-renewable/,
  /^By creating/,
];

function suggestNamespace(text) {
  const t = text.toLowerCase();

  if (t.includes("message")) return "messages";
  if (t.includes("forward")) return "forwarding";
  if (t.includes("forward")) return "forwarding";
  if (t.includes("call forwarding")) return "forwarding";
  if (t.includes("call")) return "calls";
  if (t.includes("gif")) return "media";
  if (t.includes("contact")) return "contacts";
  if (t.includes("encrypt")) return "encryption";
  if (t.includes("country")) return "common";
  if (t.includes("account") || t.includes("password")) return "auth";
  if (t.includes("country")) return "common";
  if (t.includes("emoji")) return "messages";
  if (t.includes("plan") || t.includes("purchase")) return "billing";

  return "common";
}

function camelize(text) {
  return text
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) =>
      i === 0
        ? w.toLowerCase()
        : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    )
    .join("");
}

const candidates = report.rawEnglishKeys
  .filter(k => k.iosValue.length <= 45)
  .filter(k => !SKIP.some(rx => rx.test(k.iosValue)))
  .map(k => {
    const ns = suggestNamespace(k.iosValue);
    const key = `${ns}.${camelize(k.iosValue)}`;

    return {
      raw: k.iosValue,
      semanticKey: key
    };
  });

console.log("\n=== Suggested semantic replacements ===\n");

for (const c of candidates) {
  console.log(`"${c.raw}" → "${c.semanticKey}"`);
}