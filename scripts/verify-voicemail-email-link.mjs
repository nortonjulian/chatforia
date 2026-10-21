import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';
const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
const email = read('server/services/voicemailEmail.js');
const api = read('client/src/api/voicemailApi.js');
const player = read('client/src/components/voicemail/VoicemailPlayer.jsx');
const strip = s => s.replace(/^import .*;\n/gm,'').replace(/export async function/g,'async function');
function mailer(sendMail) {
 const ctx=vm.createContext({sendMail,logger:{},Date});
 vm.runInContext(strip(email)+'\nthis.run=sendVoicemailForwardEmail;',ctx);return ctx.run;
}
test('both email formats link to Chatforia and never include the provider recording URL',async()=>{
 let sent;await mailer(async mail=>{sent=mail;})({toEmail:'owner@example.com',audioUrl:'https://api.twilio.com/private-recording',fromNumber:'+15551234567',durationSec:11});
 for(const body of [sent.text,sent.html]){assert.match(body,/https:\/\/www.chatforia.com\/voicemail/);assert.doesNotMatch(body,/api.twilio.com|private-recording/);assert.match(body,/Sign in to the Chatforia account/);}
 assert.equal(sent.subject,'New voicemail from +15551234567');assert.match(sent.text,/Duration: 11s/);
});
test('missing recipient sends nothing; delivery failure remains handled',async()=>{
 let calls=0;await mailer(async()=>{calls++;})({audioUrl:'private'});assert.equal(calls,0);
 await mailer(async()=>{throw Error('mail unavailable');})({toEmail:'owner@example.com',audioUrl:'private'});
});
function loader(get){const ctx=vm.createContext({axiosClient:{get},Blob});vm.runInContext(strip(api)+'\nthis.run=fetchVoicemailAudio;',ctx);return ctx.run;}
test('audio uses authenticated client and owner proxy by ID, never a supplied provider URL',async()=>{
 const signal=new AbortController().signal;const blob=new Blob(['audio'],{type:'audio/mpeg'});
 const run=loader(async(path,options)=>{assert.equal(path,'/voicemail/a%2Fb/audio');assert.equal(options.responseType,'blob');assert.equal(options.signal,signal);return {data:blob};});
 assert.equal(await run('a/b',signal),blob);
});
test('missing identity never fetches; empty, HTML and non-blob responses cannot play',async()=>{
 let calls=0;await assert.rejects(loader(async()=>{calls++;})(''),/identity/);assert.equal(calls,0);
 for(const data of [new Blob([],{type:'audio/mpeg'}),new Blob(['login'],{type:'text/html'}),'error']){
  await assert.rejects(loader(async()=>({data}))('vm'),/unavailable/);
 }
});
const effect=player.slice(player.indexOf('    const controller = new AbortController();'),player.indexOf('\n  }, [id, attempt]);'));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function mount(fetchVoicemailAudio){
 const state={audio:null,error:'',created:[],revoked:[]};
 const ctx=vm.createContext({id:'vm',AbortController,fetchVoicemailAudio,setAudio:v=>state.audio=v,setAudioError:v=>state.error=v,URL:{createObjectURL:blob=>{state.created.push(blob);return 'blob:owner';},revokeObjectURL:url=>state.revoked.push(url)}});
 const cleanup=vm.runInContext('(function(){'+effect+'})()',ctx);return {state,cleanup};
}
test('player publishes proxy bytes and revokes object URL when leaving',async()=>{
 const m=mount(async()=>new Blob(['audio'],{type:'audio/mpeg'}));await flush();assert.equal(m.state.audio.url,'blob:owner');m.cleanup();assert.deepEqual(m.state.revoked,['blob:owner']);
});
test('late response cannot play after leaving or switching voicemail',async()=>{
 let resolve;const m=mount(()=>new Promise(r=>{resolve=r;}));m.cleanup();resolve(new Blob(['old']));await flush();assert.equal(m.state.created.length,0);assert.equal(m.state.audio,null);
});
test('fetch failure is visible; late cancellation does not restore an error',async()=>{
 const failed=mount(async()=>{throw Error('offline');});await flush();assert.match(failed.state.error,/Unable to load/);failed.cleanup();
 let reject;const gone=mount(()=>new Promise((_,r)=>{reject=r;}));gone.cleanup();reject(Error('cancelled'));await flush();assert.equal(gone.state.error,'');
});
test('existing inbox and audio proxy retain authentication, owner and deleted checks',()=>{
 const route=read('server/routes/voicemail.js');assert.match(route,/r.use\(requireAuth\)/);assert.match(route,/id,\s+userId,\s+deleted: false/);
 const routes=read('client/src/AppRoutes.jsx');assert.match(routes,/path="voicemail" element=\{<VoicemailPage/);
 assert.doesNotMatch(player,/src=\{audioUrl\}/);assert.match(player,/audio && audio\.id === id/);
});
