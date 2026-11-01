import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  resolve(here, '../runInitialAdminBootstrap.js'),
  'utf8'
);

describe('initial administrator inspection runner safety', () => {
  test('rejects command-line arguments', () => {
    expect(source).toContain('process.argv.length !== 2');
  });

  test('requires production environment', () => {
    expect(source).toContain(
      "process.env.NODE_ENV !== 'production'"
    );
  });

  test('uses the fixed production database name', () => {
    expect(source).toContain(
      "const EXPECTED_DATABASE = 'defaultdb'"
    );
  });

  test('pins the independently verified endpoint fingerprint', () => {
    expect(source).toContain(
      '268c88704efff766fae41e45416ac701b302fe6f067b5753a3fafb90e2789bc9'
    );
  });

  test('invokes bootstrap in default dry-run mode', () => {
    expect(source).toContain(
      'bootstrapInitialAdmin(prisma)'
    );
    expect(source).not.toContain('execute: true');
  });

  test('does not expose administrator promotion CLI flags', () => {
    expect(source).not.toContain('--execute');
    expect(source).not.toContain('--force');
  });
});
