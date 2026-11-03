import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { ESLint } from 'eslint';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';

const root = process.cwd();
const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const foundation = 'e67c9ad2';
const delivery = '85cb0557';
const baseline = git('rev-parse', `${foundation}^`).trim();
const eslint = new ESLint();
const require = createRequire(import.meta.url);
const resolver = require('../../config/eslint-client-alias.cjs');
const aliasResolves = resolver.resolve(
  '@/context/UserContext',
  `${root}/client/src/AppRoutes.jsx`
).found;
const missingAliasRejected = !resolver.resolve(
  '@/does-not-exist-staff-qa',
  `${root}/client/src/AppRoutes.jsx`
).found;
const coverageExcluded = await eslint.isPathIgnored(
  `${root}/server/coverage/block-navigation.js`
);
const nodeScriptsChecked =
  (
    await eslint.calculateConfigForFile(
      `${root}/server/scripts/staff-fresh-postgres.mjs`
    )
  ).rules['no-unused-vars'][0] === 2;
assert.ok(
  aliasResolves &&
    missingAliasRejected &&
    coverageExcluded &&
    nodeScriptsChecked
);

const current = await eslint.lintFiles(['.']);
const plain = (result) => ({
  file: relative(root, result.filePath),
  messages: result.messages.map(({ ruleId, severity, line, message }) => ({
    ruleId,
    severity,
    line,
    message,
  })),
});
const tracked = new Set(git('ls-files').trim().split('\n'));
const currentResults = current.map(plain);
const reviewedResults = currentResults.filter((result) =>
  tracked.has(result.file)
);
const sources = new Map(
  currentResults.map((result) => [
    result.file,
    readFileSync(result.file, 'utf8'),
  ])
);

async function atRevision(revision) {
  const files = new Set(
    git('ls-tree', '-r', '--name-only', revision).trim().split('\n')
  );
  const changed = new Set(
    git('diff', '--name-only', revision, '--').trim().split('\n')
  );
  const results = [];
  const sourceMap = new Map();
  for (const now of currentResults) {
    if (!files.has(now.file)) continue;
    if (!changed.has(now.file)) {
      results.push(now);
      sourceMap.set(now.file, sources.get(now.file));
      continue;
    }
    const source = git('show', `${revision}:${now.file}`);
    sourceMap.set(now.file, source);
    results.push(
      plain((await eslint.lintText(source, { filePath: now.file }))[0])
    );
  }
  return { results, sources: sourceMap };
}
const fingerprint = (message, source) => {
  const line = source?.split('\n')[message.line - 1]?.trim();
  const module =
    message.ruleId === 'import/order'
      ? source
          ?.split('\n')
          .slice(message.line - 1, message.line + 20)
          .join('\n')
          .split(';')[0]
          .match(/(?:from|import)\s+['"]([^'"]+)['"]/)?.[1]
      : null;
  return JSON.stringify([
    message.ruleId,
    message.severity,
    message.message,
    module || line,
  ]);
};
const counts = (results) =>
  results.reduce(
    (total, result) => {
      for (const message of result.messages)
        total[message.severity === 2 ? 'errors' : 'warnings']++;
      return total;
    },
    { errors: 0, warnings: 0 }
  );
function compare(older, newer, newerSources) {
  const oldFiles = new Map(
    older.results.map((result) => [result.file, result])
  );
  const introduced = [];
  for (const result of newer) {
    const previous = new Map();
    for (const message of oldFiles.get(result.file)?.messages || []) {
      const key = fingerprint(message, older.sources.get(result.file));
      previous.set(key, (previous.get(key) || 0) + 1);
    }
    for (const message of result.messages) {
      const key = fingerprint(message, newerSources.get(result.file));
      if (previous.get(key)) previous.set(key, previous.get(key) - 1);
      else introduced.push({ file: result.file, ...message });
    }
  }
  return introduced;
}
const beforeBranch = await atRevision(baseline);
const checkpoint = await atRevision(foundation);
const previousDelivery = await atRevision(delivery);
const branchIntroduced = compare(beforeBranch, reviewedResults, sources);
const takeoverIntroduced = compare(checkpoint, reviewedResults, sources);
const introducedSinceDelivery = compare(
  previousDelivery,
  reviewedResults,
  sources
);
const remainingErrorsByRule = {};
for (const result of currentResults)
  for (const finding of result.messages)
    if (finding.severity === 2)
      remainingErrorsByRule[finding.ruleId] =
        (remainingErrorsByRule[finding.ruleId] || 0) + 1;
const report = {
  method:
    'All revisions evaluated under the same repaired current ESLint configuration. Message comparison includes rule, severity, text, and source line; moved unchanged lines are retained baseline findings.',
  baseline,
  foundation,
  delivery,
  configuration: {
    aliasResolves,
    missingAliasRejected,
    coverageExcluded,
    nodeScriptsChecked,
  },
  remainingErrorsByRule,
  worktreeDirty: Boolean(git('status', '--porcelain').trim()),
  revision: git('rev-parse', 'HEAD').trim(),
  current: counts(currentResults),
  tracked: counts(reviewedResults),
  untracked: counts(
    currentResults.filter((result) => !tracked.has(result.file))
  ),
  baselineUnderCurrentRules: counts(beforeBranch.results),
  checkpointUnderCurrentRules: counts(checkpoint.results),
  previousDeliveryUnderCurrentRules: counts(previousDelivery.results),
  branchIntroduced,
  takeoverIntroduced,
  introducedSinceDelivery,
};
writeFileSync(
  '/tmp/chatforia-staff-lint-audit.json',
  JSON.stringify(report, null, 2) + '\n'
);
console.log(
  JSON.stringify(
    {
      ...report,
      introducedSinceDelivery: {
        total: introducedSinceDelivery.length,
        errors: introducedSinceDelivery.filter((x) => x.severity === 2).length,
      },
      branchIntroduced: {
        total: branchIntroduced.length,
        errors: branchIntroduced.filter((x) => x.severity === 2).length,
      },
      takeoverIntroduced: {
        total: takeoverIntroduced.length,
        errors: takeoverIntroduced.filter((x) => x.severity === 2).length,
      },
    },
    null,
    2
  )
);
console.log('Details: /tmp/chatforia-staff-lint-audit.json');
if (
  branchIntroduced.length ||
  counts(currentResults.filter((result) => !tracked.has(result.file))).errors ||
  counts(currentResults.filter((result) => !tracked.has(result.file))).warnings
)
  process.exitCode = 1;
