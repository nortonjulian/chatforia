import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { assertPackageDatasource } from './deploy-migration-package.mjs';

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');

test('accepts the release schema despite its datasource comment', () => {
  assert.match(schema, /\/\/.*datasource\s+/);
  assert.doesNotThrow(() => assertPackageDatasource(schema));
});

test('rejects a second actual datasource or an alternate URL', () => {
  assert.throws(() => assertPackageDatasource(`${schema}\n` +
    'datasource extra { provider = "postgresql" url = env("DATABASE_URL") }'),
  /Package datasource requires separate review/);
  assert.throws(() => assertPackageDatasource(
    schema.replace('env("DATABASE_URL")', 'env("SHADOW_DATABASE_URL")')),
  /Package datasource requires separate review/);
});
