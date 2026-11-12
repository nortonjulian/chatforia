import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const helper = readFileSync('server/scripts/deploy-systemd-api-operator.sh');
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
};
const git = (directory, ...args) => run('git', ['-C', directory, ...args]);

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'chatforia-operator-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const origin = join(root, 'origin.git');
  const checkout = join(root, 'checkout');
  run('git', ['init', '--bare', '--initial-branch=main', origin]);
  run('git', ['clone', origin, checkout]);
  git(checkout, 'switch', '-c', 'main');
  git(checkout, 'config', 'user.name', 'Synthetic QA');
  git(checkout, 'config', 'user.email', 'synthetic@example.invalid');
  mkdirSync(join(checkout, 'server/scripts'), { recursive: true });
  const localHelper = join(checkout, 'server/scripts/deploy-systemd-api-operator.sh');
  writeFileSync(localHelper, helper);
  writeFileSync(join(checkout, 'server/scripts/deploy-systemd-api.sh'), '#!/bin/bash\necho synthetic-host-script\n');
  git(checkout, 'add', '.');
  git(checkout, 'commit', '-m', 'Synthetic reviewed release');
  git(checkout, 'push', 'origin', 'main');
  const commit = git(checkout, 'rev-parse', 'HEAD');
  const packagePath = join(root, 'release-package.json');
  const bytes = '{"synthetic":true}\n';
  writeFileSync(packagePath, bytes);
  const packageSha = createHash('sha256').update(bytes).digest('hex');
  const receiptPath = join(root, 'handoff.json');
  writeFileSync(receiptPath, JSON.stringify({ version: 1, repository: 'nortonjulian/chatforia',
    workflow: 'deploy-backend.yml', ref: 'refs/heads/main', commit,
    package_sha256: packageSha, run_id: 123, run_attempt: 1 }));
  const key = join(root, 'synthetic-key');
  const knownHosts = join(root, 'known_hosts');
  writeFileSync(key, 'synthetic-key\n');
  writeFileSync(knownHosts, 'example.invalid synthetic-host-key\n');
  const mocks = join(root, 'mocks');
  mkdirSync(mocks);
  writeFileSync(join(mocks, 'ssh'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$MOCK_SSH_ARGS"\ncat > "$MOCK_SSH_INPUT"\n', { mode: 0o755 });
  const sshArgs = join(root, 'ssh-args');
  const sshInput = join(root, 'ssh-input');
  const env = { ...process.env, PATH: `${mocks}:${process.env.PATH}`,
    API_DO_OPERATOR_KNOWN_HOSTS: knownHosts, MOCK_SSH_ARGS: sshArgs, MOCK_SSH_INPUT: sshInput };
  const invoke = () => spawnSync('bash', [localHelper, receiptPath, packagePath, checkout,
    'example.invalid', key], { cwd: checkout, env, encoding: 'utf8' });
  return { root, origin, checkout, commit, packagePath, packageSha, receiptPath,
    sshArgs, sshInput, invoke };
}

test('operator helper uses the receipt commit and package digest with strict pinned SSH', (t) => {
  const f = fixture(t);
  const result = f.invoke();
  assert.equal(result.status, 0, result.stderr);
  const args = readFileSync(f.sshArgs, 'utf8');
  assert.match(args, /StrictHostKeyChecking=yes/);
  assert.match(args, /UserKnownHostsFile=/);
  assert.match(args, /root@example\.invalid/);
  assert.match(args, new RegExp(f.commit));
  assert.match(args, new RegExp(f.packageSha));
  assert.equal(readFileSync(f.sshInput, 'utf8'), '#!/bin/bash\necho synthetic-host-script\n');
});

test('operator helper rejects changed package before any SSH side effect', (t) => {
  const f = fixture(t);
  writeFileSync(f.packagePath, '{"synthetic":false}\n');
  assert.notEqual(f.invoke().status, 0);
  assert.equal(existsSync(f.sshArgs), false);
});

test('operator helper rejects a receipt for another workflow before any SSH side effect', (t) => {
  const f = fixture(t);
  const receipt = JSON.parse(readFileSync(f.receiptPath, 'utf8'));
  receipt.workflow = 'another-workflow.yml';
  writeFileSync(f.receiptPath, JSON.stringify(receipt));
  assert.notEqual(f.invoke().status, 0);
  assert.equal(existsSync(f.sshArgs), false);
});

test('operator helper rejects a stale main commit before any SSH side effect', (t) => {
  const f = fixture(t);
  const other = join(f.root, 'other');
  run('git', ['clone', f.origin, other]);
  git(other, 'config', 'user.name', 'Synthetic QA');
  git(other, 'config', 'user.email', 'synthetic@example.invalid');
  writeFileSync(join(other, 'new-file'), 'later main commit\n');
  git(other, 'add', '.');
  git(other, 'commit', '-m', 'Advance main');
  git(other, 'push', 'origin', 'main');
  assert.notEqual(f.invoke().status, 0);
  assert.equal(existsSync(f.sshArgs), false);
});
