import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  constants,
  openSync,
  fstatSync,
  closeSync,
  readFileSync,
  lstatSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import net from 'node:net';
import { createClient } from 'redis';

export function readDevGoogleCredentials(path) {
  assert.ok(
    !resolve(path).startsWith(resolve(process.cwd()) + '/'),
    'Credentials must be outside checkout'
  );
  const parent = lstatSync(resolve(path, '..'));
  assert.ok(
    parent.isDirectory() &&
      parent.uid === process.getuid() &&
      (parent.mode & 0o777) === 0o700,
    'Credential directory must be owner-only 0700'
  );
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd);
    assert.ok(
      info.isFile() &&
        info.uid === process.getuid() &&
        (info.mode & 0o777) === 0o600,
      'Credentials must be owner-only 0600'
    );
    const data = JSON.parse(readFileSync(fd, 'utf8'));
    assert.equal(data.project_id, 'chatforia-dev');
    assert.equal(data.client_name, 'Chatforia Web (Dev)');
    assert.equal(
      data.redirect_uri,
      'http://localhost:5002/auth/google/callback'
    );
    assert.match(
      data.client_id,
      /^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/
    );
    assert.ok(
      typeof data.client_secret === 'string' && data.client_secret.length > 0
    );
    assert.match(data.qa_email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    return data;
  } finally {
    closeSync(fd);
  }
}
export async function freshRedis(directory, binary) {
  const reservation = net.createServer();
  await new Promise((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', resolve);
  });
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const password = randomBytes(32).toString('hex');
  const config = join(directory, 'redis.conf');
  writeFileSync(
    config,
    `bind 127.0.0.1\nport ${port}\nprotected-mode yes\nrequirepass ${password}\nsave ""\nappendonly no\ndir ${directory}\nlogfile ${join(directory, 'redis.log')}\n`,
    { mode: 0o600 }
  );
  const child = spawn(binary, [config], {
    stdio: 'ignore',
    env: { PATH: process.env.PATH, LC_ALL: 'C' },
  });
  if (child.pid)
    writeFileSync(
      join(directory, 'redis-child.json'),
      JSON.stringify({ pid: child.pid, parent: process.pid, directory }),
      { mode: 0o600 }
    );
  let exited = false;
  child.on('error', () => {
    exited = true;
  });
  child.on('exit', () => {
    exited = true;
  });
  const url = `redis://:${password}@127.0.0.1:${port}`;
  let client;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (exited) throw Error('Fresh Redis failed to start');
    client = createClient({
      url,
      socket: { reconnectStrategy: false, connectTimeout: 250 },
    });
    client.on('error', () => {});
    try {
      await client.connect();
      assert.equal(await client.ping(), 'PONG');
      const identity = await client.info('server');
      assert.ok(identity.includes('process_id:' + child.pid + '\r\n'));
      assert.equal(await client.dbSize(), 0);
      break;
    } catch {
      if (client.isOpen) client.destroy();
      client = null;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  if (!client) {
    child.kill('SIGTERM');
    throw Error('Fresh Redis unavailable');
  }
  await client.quit();
  return {
    url,
    async stop() {
      if (exited) return;
      await new Promise((resolve) => {
        child.once('exit', resolve);
        child.kill('SIGTERM');
      });
    },
  };
}
export function googleHelperHtml(helper) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Isolated Google OAuth QA</title></head><body>
<h1>Real Google / isolated synthetic Chatforia</h1>
<p>Use this helper and the application in the same browser/private window. Never enter your Google password here.</p>
<ol><li>Open <a href="/" target="_blank" rel="noopener">Chatforia</a>, click Continue with Google, and use the Google email entered in the hidden setup prompt.</li>
<li>On the first Google callback, stop at the Chatforia MFA page. Return here and click Prepare Support. This links your real Google subject before protection and invalidates the first challenge.</li>
<li>Start Google sign-in again from Chatforia. Stop at the MFA page and click Check current access here: staff/admin must be denied.</li>
<li>Return here for a fresh qa_support code, then enter it on the Chatforia verification page. After returning to the app, Check current access: Support 200, Admin 403.</li>
<li>Log out using Chatforia, then Check current access again: staff/admin must be denied.</li></ol>
<button id="prepare">Prepare Support after first Google callback</button><button id="check">Check current access</button>
<pre id="status" role="status">Waiting for setup…</pre><h2>qa_support verification code</h2><code id="code">Fetching…</code><p id="expiry"></p>
<script type="module">
const base=${JSON.stringify(helper)};
const status=document.getElementById('status'),code=document.getElementById('code'),expiryText=document.getElementById('expiry');
let expiry=0,received=0;
async function refresh(){if(document.hidden){code.textContent='Return here for a fresh code.';return;}
try{const r=await fetch(base+'/codes',{cache:'no-store',signal:AbortSignal.timeout(2000)});if(!r.ok)throw Error();const data=await r.json();
if(document.hidden)return;const item=data.accounts.find(a=>a.username==='qa_support');expiry=data.expiresAt-data.serverTime;received=performance.now();
code.textContent=item?.code?item.code:'Wait for the next code…';expiryText.textContent=item?.code?'Expires in '+Math.ceil(expiry/1000)+' seconds.':'';}catch{code.textContent='Refresh unavailable; no code shown.';expiry=0;}}
async function action(path,method='GET'){try{const r=await fetch(base+path,{method,cache:'no-store'});const data=await r.json();status.textContent=JSON.stringify(data,null,2);}catch{status.textContent='Local check unavailable.';}}
document.getElementById('prepare').onclick=()=>action('/prepare-support','POST');document.getElementById('check').onclick=()=>action('/check');
document.addEventListener('visibilitychange',()=>{code.textContent='Fetching a fresh code…';refresh();});window.addEventListener('focus',refresh);
setInterval(refresh,1000);setInterval(()=>{if(document.hidden||performance.now()-received>3000||expiry-(performance.now()-received)<=5000)code.textContent='Return here / wait for a fresh code…';},200);refresh();action('/check');
</script></body></html>`;
}
