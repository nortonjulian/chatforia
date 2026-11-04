# Repository lint investigation

This follow-up compares the staff-security branch with its actual pre-branch
parent, `4522e062`, the foundation checkpoint `e67c9ad2`, and the previous delivery
`85cb0557`. It does not reset/check out another worktree or rewrite unrelated
application logic.

## Method and actual results

`npm run audit:staff-lint` uses ESLint's API to evaluate current files and historic
file contents under **the same repaired configuration**. It compares rule,
severity, message and source line; import diagnostics use their module identity,
so moving an unchanged import does not invent a new defect. It separately reports
untracked findings and verifies that a valid client alias resolves, a missing
alias still fails, generated coverage is excluded and Node ESM scripts are checked.
The command fails if the branch introduces findings or untracked files have them.

| Source snapshot, under the same current rules           | Errors | Warnings |
| ------------------------------------------------------- | -----: | -------: |
| Before the branch (`4522e062`)                          |    384 |    2,764 |
| Foundation checkpoint (`e67c9ad2`)                      |    386 |    2,796 |
| Previous delivery (`85cb0557`)                          |    386 |    2,806 |
| Follow-up implementation                                |    384 |    2,609 |
| New branch findings compared with the pre-branch parent |  **0** |    **0** |
| New findings since the previous delivery                |  **0** |    **0** |

These are comparable findings, not a historical claim that the old lint command
worked. The original configuration was initially blocked by missing plugins,
legacy configs in a flat-config setup, and duplicate plugin registration. The
previous delivery repaired those startup problems and recorded 894 errors and
2,793 warnings. This follow-up found additional configuration defects and
re-evaluated all snapshots consistently.

## What was fixed

- Vite's existing `@/` alias points to `client/src`, but ESLint's Node resolver
  did not know it. An exact-path resolver now validates these imports against
  real files. It does not ignore missing modules. This removes 510 false error
  reports; it does not change production imports or disable a rule.
- The intended coverage exclusion did not match nested generated coverage
  output. `**/coverage/**` now excludes generated reports rather than treating
  them as product source.
- Staff QA/release `.mjs` files were not receiving the intended Node rules.
  Applying the normal recommended checks exposed two project defects: an unused
  fixture helper and ambiguous newline/computed-property call formatting. Both
  were fixed. The unused helper was not a running test and no tests were removed.
- Staff-project import order, an unused Jest import and confusing default-import
  identifiers were corrected. In the modified server entry points only import
  declarations/grouping were reconciled; application bodies were preserved
  apart from the explicitly requested user-details API wiring.
- The resolver is an explicit development dependency, locked in package-lock.
  No lint rule's severity or rule options were relaxed to obtain a pass.

## What remains, and why root CI is still red

The full `npm run lint` gate remains red with **384 errors and 2,609 warnings**.
All remaining findings reproduce in the pre-branch source under these rules;
the normalized branch comparison has zero introduced findings. They remain
visible in the full lint output and were not blanket-fixed or suppressed.

Largest existing error categories include 112 empty-block findings, 84 undefined
names, 81 React display-name findings, 31 import-resolution findings, 14 media
caption findings and 13 React-refresh export findings. Existing hook,
accessibility, export and other JavaScript findings also remain.

The remaining import-resolution findings are mixed configuration/runtime and
source debt, not 31 automatically proven missing production dependencies:

- `k6/*` imports belong to a non-Node runtime.
- Legacy server/Jest aliases such as `@utils`, `@prismaClient`, `@providers` and
  `@config` need their own existing-runtime resolution review.
- Node package-export resolution has existing false-positive cases such as
  `eslint/config` and `@vitejs/plugin-react` (the latter loads in the browser
  rehearsal and client build).
- Existing relative imports also point at genuinely absent paths, including
  legacy contacts/wireless wrappers and old SMS/storage helpers. Those were
  already present before this branch and are outside the staff-security change.

The Node warning about this repository's untyped ESM `eslint.config.js` is also
pre-existing. Setting the whole repository to ESM just to silence it could break
unrelated scripts, so it was not done.

The feature gate `npm run lint:staff-security` checks the full staff security
folder, staff/admin detail routes, staff QA scripts, new UI components and tests
with zero allowed warnings. It passes; it does not replace or weaken root lint.
Machine evidence is `/tmp/chatforia-staff-lint-audit.json` and full root lint
output is `/tmp/chatforia-staff-repository-lint.log`.

The final documentation review reran the baseline-aware audit and scoped lint at
`672eb358`; the same zero-introduced-finding boundary remains required. The root
findings remain a release gate, not an authorization to suppress baseline debt.

The PR security review reran the comparison on the `fd64a584` changes before
commit: 384 errors / 2,609 warnings, zero introduced or untracked findings. Scoped
lint passed again. PR CI now runs scoped lint explicitly; it does not run or
replace the still-failing full repository gate.
