import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';
const source = readFileSync(new URL('../client/src/api/contacts.js', import.meta.url), 'utf8');
function load(post) {
  const ctx = vm.createContext({ axios: { post } });
  vm.runInContext(source.replace(/^import .*;\n/, '').replace('export async function', 'async function') + '\nthis.run = importContacts;', ctx);
  return ctx.run;
}
test('selected preview phones map to the real endpoint; emails do not interfere', async () => {
  let request;
  const run = load(async (...args) => { request = JSON.parse(JSON.stringify(args)); return { data: { ok:true, importedCount:2, items:[{},{}] } }; });
  const result = await run({ contacts:[{name:' Person ', phones:[' +15551234567 ','+15557654321'],emails:['p@example.com']}] });
  assert.deepEqual(request, ['/contacts/import',{items:[{externalPhone:'+15551234567',externalName:'Person'},{externalPhone:'+15557654321',externalName:'Person'}]}]);
  assert.equal(result.importedCount,2);
});
test('email-only selection fails visibly without a request', async () => {
  let calls=0; const run=load(async()=>{calls++;});
  await assert.rejects(run({contacts:[{name:'Email',emails:['p@example.com']}]}), /phone number/);
  assert.equal(calls,0);
});
test('mixed selection sends only actual selected phone values', async () => {
  const run=load(async (url,body)=>{assert.equal(body.items.length,1);assert.equal(body.items[0].externalName,'Phone');return {data:{ok:true,importedCount:1,items:[{}]}};});
  await run({contacts:[{name:'Email',emails:['e@example.com']},{name:'Phone',phones:['',null,'+15551234567']}]});
});
test('backend failure remains a failure', async()=>{
  const run=load(async()=>{throw new Error('Network failed');});
  await assert.rejects(run({contacts:[{phones:['+15551234567']}]}),/Network failed/);
});
test('unacknowledged or malformed success cannot close the import as successful',async()=>{
  for(const data of [{},{ok:false},{ok:true,importedCount:1,items:[]},{ok:true,importedCount:-1,items:[]}]){
    const run=load(async()=>({data}));
    await assert.rejects(run({contacts:[{phones:['+15551234567']}]}),/did not confirm/);
  }
});
test('UI uses acknowledged count rather than invented added/updated statistics',()=>{
  const ui=readFileSync(new URL('../client/src/components/ImportContactsModal.jsx',import.meta.url),'utf8');
  assert.match(ui,/result.importedCount/);assert.doesNotMatch(ui,/result\.(added|updated|skippedDuplicates|invalid)/);
  assert.match(ui,/error\?\.response\?\.data\?\.error/);
});
