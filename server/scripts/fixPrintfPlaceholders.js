import fs from "fs";
import path from "path";

const ROOT = path.resolve("../client/public/locales");

const REPLACEMENTS = {
  "common.userWithId": [
    [/%d/g, "{id}"]
  ],

  "current_plan_format": [
    [/%@/g, "{plan}"]
  ],

  "chat.roomNumber": [
    [/#%d/g, "#{number}"],
    [/#%@/g, "#{number}"]
  ],

  "messages.readByUser": [
    [/%@/g, "{name}"]
  ],

  "messages.readByCount": [
    [/%d/g, "{count}"]
  ],

  "messages.seenByPeopleCount": [
    [/%d/g, "{count}"]
  ],

  "messages.videoLoadFailed": [
    [/%@/g, "{error}"]
  ],

  "messages.selectedVideoLoadFailed": [
    [/%@/g, "{error}"]
  ],

  "premium.requiresPlan": [
    [/%@/g, "{plan}"]
  ],

  "upgrade.requires_plan_format": [
    [/%@/g, "{plan}"]
  ],

  "report.reportingMessageFrom": [
    [/%@/g, "{name}"]
  ],

  "gif.sendFailed": [
    [/%@/g, "{error}"]
  ],

  "contacts.importedContactsCount": [
    [/%d/g, "{count}"]
  ],

  "contacts.contactsCouldNotImportCount": [
    [/%d/g, "{count}"]
  ],

  "calls.callingDestination": [
    [/%@/g, "{destination}"]
  ],

  "calls.incomingCalling": [
    [/%@/g, "{caller}"]
  ],

  "calls.connecting": [
    [/%@/g, "{destination}"]
  ],

  "calls.inCallWith": [
    [/%@/g, "{name}"]
  ],

  "sms.threadNumber": [
    [/#%d/g, "#{number}"]
  ],

  "ios.chat_number": [
    [/#%@/g, "#{number}"],
    [/#%d/g, "#{number}"]
  ],

  "ios.kind_format": [
    [/%@/g, "{kind}"]
  ],

  "ios.remaining_of": [
    [/%@/g, "{value}"]
  ],

  "sound.upgradeUnlockMessage": [
    [/%@/g, "{sound}"]
  ],

  "sound.upgradePreviewMessage": [
    [/%@/g, "{sound}"]
  ],

  "invite.shareMessageWithName": [
    [/%@/g, "{value}"]
  ],

  "invite.shareMessageGeneric": [
    [/%@/g, "{value}"]
  ]
};

function walk(obj, keyPath = "") {
  for (const [key, value] of Object.entries(obj || {})) {
    const full = keyPath ? `${keyPath}.${key}` : key;

    if (value && typeof value === "object" && !Array.isArray(value)) {
      walk(value, full);
      continue;
    }

    if (typeof value !== "string") continue;

    if (REPLACEMENTS[full]) {
      let updated = value;

      for (const [pattern, replacement] of REPLACEMENTS[full]) {
        updated = updated.replace(pattern, replacement);
      }

      obj[key] = updated;
    }
  }
}

for (const lang of fs.readdirSync(ROOT)) {
  const file = path.join(ROOT, lang, "translation.json");

  if (!fs.existsSync(file)) continue;

  const json = JSON.parse(fs.readFileSync(file, "utf8"));

  walk(json);

  fs.writeFileSync(
    file,
    JSON.stringify(json, null, 2) + "\n"
  );

  console.log(`✓ ${lang}`);
}

console.log("\nDone.");