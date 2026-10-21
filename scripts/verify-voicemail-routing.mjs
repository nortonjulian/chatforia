import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const source = read('client/src/utils/voicemailLink.js');
const link = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
for (const [value, expected] of [
  ['/voicemail', '/voicemail'], ['/voicemail/', '/voicemail'],
  ['/voicemail?id=cm123', '/voicemail?id=cm123'], ['/voicemail?id=abc_123-45', '/voicemail?id=abc_123-45'],
  ['/voicemail?tracking=email&id=cm123', '/voicemail?id=cm123'],
  ['/voicemail?id=', null], ['/voicemail?id=a&id=b', null],
  ['/voicemail?id=a%2Fb', null], ['/voicemail?id=%0Aabc', null],
  ['/voicemail?id=' + 'a'.repeat(129), null], ['/voicemail/other', null],
  ['//evil.example/voicemail', null], ['https://evil.example/voicemail', null],
  ['/voicemail#other', null], ['/settings', null], [null, null],
]) test('safe sign-in target: ' + JSON.stringify(value), () => assert.equal(link.voicemailLinkTarget(value), expected));
test('pending voicemail survives sign-in, expires, and is consumed without retaining transcript text', () => {
  const values = new Map();
  globalThis.sessionStorage = { getItem: k => values.get(k), setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) };
  assert.equal(link.rememberVoicemailReturn('/voicemail?id=cm123'), '/voicemail?id=cm123');
  assert.equal(link.pendingVoicemailReturn(), '/voicemail?id=cm123');
  assert.equal(link.rememberVoicemailReturn('//evil.example'), null);
  assert.equal(link.pendingVoicemailReturn(), '/voicemail?id=cm123');
  link.clearVoicemailReturn(); assert.equal(link.pendingVoicemailReturn(), null);
  values.set('chatforia.voicemailReturn', JSON.stringify({target:'/voicemail?id=cm123',expires:0}));
  assert.equal(link.pendingVoicemailReturn(), null);
  values.set('chatforia.voicemailReturn', JSON.stringify({target:'//evil.example',expires:Date.now()+9999}));
  assert.equal(link.pendingVoicemailReturn(), null);
  globalThis.sessionStorage = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }, removeItem() { throw Error('blocked'); } };
  assert.equal(link.rememberVoicemailReturn('/voicemail'), '/voicemail');
  assert.equal(link.pendingVoicemailReturn(), null); link.clearVoicemailReturn();
});
test('actual email links identify the recording and never reveal its provider URL', async () => {
  const emails = [];
  const context = vm.createContext({sendMail: async e => emails.push(e), logger:{info(){},warn(){},error(){}}, Date});
  vm.runInContext(read('server/services/voicemailEmail.js').replace(/^import .*;\n/gm,'').replace('export async function','async function') + '\nthis.send = sendVoicemailForwardEmail;', context);
  await context.send({voicemailId:'cm123',toEmail:'test@example.com',audioUrl:'https://api.twilio.com/private',createdAt:new Date()});
  assert.match(emails[0].text, /https:\/\/www.chatforia.com\/voicemail\?id=cm123/);
  assert.match(emails[0].html, /voicemail\?id=cm123/);
  assert.doesNotMatch(JSON.stringify(emails[0]), /api\.twilio\.com/);
  await context.send({toEmail:'test@example.com',audioUrl:'https://api.twilio.com/private'});
  assert.match(emails[1].text, /https:\/\/www.chatforia.com\/voicemail/);
  assert.doesNotMatch(emails[1].text, /id=undefined/);
});
test('domain association preserves eSIM checkout and adds only voicemail paths', () => {
  const details = JSON.parse(read('client/public/.well-known/apple-app-site-association')).applinks.details;
  const entry = details.find(e => e.appID === '975B563V2R.com.chatforia.Chatforia');
  for (const path of ['/mobile/esim/checkout-complete*','/mobile/esim/checkout-canceled*','/voicemail','/voicemail/']) assert.ok(entry.paths.includes(path));
  assert.ok(!entry.paths.includes('*'));
});
test('recording callback supplies the saved identity; public route and both sign-in methods retain it', () => {
  assert.match(read('server/routes/webhooksTwilio.js'), /sendVoicemailForwardEmail\(\{\s*voicemailId: voicemail\.id/);
  assert.match(read('client/src/AppRoutes.jsx'), /path="\/voicemail" element=\{<VoicemailSignIn/);
  assert.match(read('client/src/components/LoginForm.jsx'), /navigate\(destination\)/);
  assert.match(read('client/src/components/LoginForm.jsx'), /auth\/complete\$\{target/);
  assert.match(read('client/src/pages/OAuthComplete.jsx'), /voicemailLinkTarget\(searchParams.get\('next'\)\)/);
});
