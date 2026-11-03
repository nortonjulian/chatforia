import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectNotices } from './third-party-notices.mjs';

test('collects scoped and nested dependencies, preserves texts, ignores nested manifests and unused packages', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'notices-'));
  try {
    const make = (name, license = true) => {
      const root = path.join(temp, 'node_modules', name);
      fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
      fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name, version: '1.2.3', license: 'MIT' }));
      fs.writeFileSync(path.join(root, 'dist/package.json'), '{"type":"module"}');
      if (license) {
        fs.writeFileSync(path.join(root, 'LICENSE'), 'Copyright fixture\nPermission text');
        fs.writeFileSync(path.join(root, 'NOTICE'), 'Additional attribution');
      }
      return path.join(root, 'dist/index.js');
    };
    const scoped = make('@scope/component');
    const transitive = make('parent/node_modules/child', false);
    make('unused');
    const result = collectNotices([scoped, scoped + '?query', transitive, '/src/app.js']);
    assert.equal(result.length, 2);
    assert.equal(result[0].name, '@scope/component');
    assert.equal(result[0].version, '1.2.3');
    assert.deepEqual(result[0].notices.map(n => n.text), ['Copyright fixture\nPermission text', 'Additional attribution']);
    assert.equal(result[1].notices.length, 0);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
