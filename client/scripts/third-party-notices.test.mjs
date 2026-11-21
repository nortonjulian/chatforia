import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
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

test('supplements are exact-version bound and fail on changed license content', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'notices-supplement-'));
  try {
    const root = path.join(temp, 'node_modules/example');
    fs.mkdirSync(root, { recursive: true });
    const manifest = path.join(root, 'package.json');
    fs.writeFileSync(manifest, JSON.stringify({ name: 'example', version: '2.0.0' }));
    fs.writeFileSync(path.join(temp, 'supplemental-notices.json'), JSON.stringify({
      'example@1.0.0': { files: [{ file: 'LICENSE', sha256: 'invalid', source: 'https://example.com/pinned/LICENSE' }] },
    }));
    const ids = [path.join(root, 'index.js')];
    assert.equal(collectNotices(ids, temp)[0].notices.length, 0);
    fs.writeFileSync(manifest, JSON.stringify({ name: 'example', version: '1.0.0' }));
    fs.writeFileSync(path.join(temp, 'LICENSE'), 'changed text');
    assert.throws(() => collectNotices(ids, temp), /checksum mismatch/);
    fs.writeFileSync(path.join(temp, 'supplemental-notices.json'), JSON.stringify({
      'example@1.0.0': { files: [{ file: 'LICENSE', sha256: createHash('sha256').update('changed text').digest('hex'), source: 'https://example.com/pinned/LICENSE' }] },
    }));
    const notice = collectNotices(ids, temp)[0].notices[0];
    assert.equal(notice.text, 'changed text');
    assert.equal(notice.source, 'https://example.com/pinned/LICENSE');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
