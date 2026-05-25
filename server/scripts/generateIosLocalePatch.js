import fs from "fs";

const INPUT =
  "./scripts/ios-hardcoded-strings.json";

const OUTPUT =
  "./scripts/ios-locale-patch.json";

const strings = JSON.parse(
  fs.readFileSync(INPUT, "utf8")
);

const patch = {};

for (const str of strings) {
  const key = str
    .toLowerCase()
    .replace(/\\\(.*?\\\)/g, "value")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 80);

  patch[`ios.${key}`] = str;
}

fs.writeFileSync(
  OUTPUT,
  JSON.stringify(patch, null, 2)
);

console.log(
  `✅ Generated ${strings.length} locale keys`
);