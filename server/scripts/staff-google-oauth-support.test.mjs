import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  symlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { readDevGoogleCredentials } from './staff-google-oauth-support.mjs';
const folder = mkdtempSync('/private/tmp/chatforia-google-loader-test-');
const value = {
  project_id: 'chatforia-dev',
  client_name: 'Chatforia Web (Dev)',
  redirect_uri: 'http://localhost:5002/auth/google/callback',
  client_id: 'synthetic.apps.googleusercontent.com',
  client_secret: 'synthetic-only',
  qa_email: 'synthetic@example.test',
};
function fixture(name, data = value) {
  const p = join(folder, name);
  writeFileSync(p, JSON.stringify(data), { mode: 0o600 });
  return p;
}
test('owner-only development credentials load without exposing their values', () => {
  const path = fixture('valid.json');
  assert.equal(readDevGoogleCredentials(path).client_secret, 'synthetic-only');
});
test('wrong environment and callback are rejected', () => {
  assert.throws(() =>
    readDevGoogleCredentials(
      fixture('wrong-project.json', { ...value, project_id: 'another-project' })
    )
  );
  assert.throws(() =>
    readDevGoogleCredentials(
      fixture('wrong-callback.json', {
        ...value,
        redirect_uri: 'https://example.invalid/auth/google/callback',
      })
    )
  );
});
test('broad permissions and symbolic links fail closed', () => {
  const p = fixture('public.json');
  chmodSync(p, 0o644);
  assert.throws(() => readDevGoogleCredentials(p));
  const target = fixture('private.json'),
    link = join(folder, 'linked.json');
  symlinkSync(target, link);
  assert.throws(() => readDevGoogleCredentials(link));
  const broad = join(folder, 'broad');
  mkdirSync(broad, { mode: 0o755 });
  const file = join(broad, 'private.json');
  writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
  assert.throws(() => readDevGoogleCredentials(file));
});
