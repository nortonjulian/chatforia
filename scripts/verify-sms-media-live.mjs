import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const source = async path => readFile(new URL(path, root), 'utf8');
const moduleFrom = async path => import('data:text/javascript;base64,' + Buffer.from(await source(path)).toString('base64'));
const {createSmsThreadLoader, subscribeSmsThread} = await moduleFrom('client/src/utils/smsThreadLive.js');
const {smsMediaKind} = await moduleFrom('client/src/utils/smsMediaKind.js');
const deferred = () => { let resolve, reject; const promise = new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; };
test('actual response MIME identifies stored audio even when URL has no extension',()=>{
 assert.equal(smsMediaKind('https://media.example/opaque', 'audio/mp4'),'audio');
 assert.equal(smsMediaKind({url:'x.jpg',contentType:'image/jpeg'},'audio/mp4'),'audio');
 assert.equal(smsMediaKind('x.mp4','video/mp4'),'video');
 assert.equal(smsMediaKind('x.jpg','image/jpeg'),'image');
 assert.equal(smsMediaKind('x.m4a?signature=x','application/octet-stream'),'audio');
 assert.equal(smsMediaKind('x.m4a','text/html'),'file');
 assert.equal(smsMediaKind(null),'file');
});
test('event during initial load queues fresh fetch and rejects the stale initial result',async()=>{
 const a=deferred(),b=deferred(),rows=[];let calls=0;
 const loader=createSmsThreadLoader({fetchThread:()=>[a,b][calls++].promise,onThread:v=>rows.push(v)});
 const work=loader.refresh();loader.refresh();a.resolve('old');await Promise.resolve();b.resolve('new');await work;
 assert.equal(calls,2);assert.deepEqual(rows,['new']);loader.dispose();
});
test('failure preserves displayed history and an explicit retry can recover',async()=>{
 const rows=[],errors=[];let fail=false;
 const loader=createSmsThreadLoader({fetchThread:async()=>{if(fail)throw Error('offline');return 'saved';},onThread:v=>rows.push(v),onError:e=>errors.push(e)});
 await loader.refresh();fail=true;await loader.refresh();assert.deepEqual(rows,['saved']);assert.equal(errors.length,1);
 fail=false;await loader.refresh();assert.deepEqual(rows,['saved','saved']);loader.dispose();
});
test('account/thread disposal rejects late responses, errors and refresh notifications',async()=>{
 const a=deferred();let writes=0;
 const loader=createSmsThreadLoader({fetchThread:()=>a.promise,onThread:()=>writes++,onError:()=>writes++,onRefresh:()=>writes++});
 const work=loader.refresh();loader.dispose();a.resolve('private history');await work;await loader.refresh();assert.equal(writes,0);
});
test('local cache failure cannot hide successful server history',async()=>{
 let saved=false;const loader=createSmsThreadLoader({fetchThread:async()=>1,onThread:()=>{saved=true;},cache:async()=>{throw Error('quota');},onError:()=>assert.fail('cache is best effort')});
 await loader.refresh();assert.equal(saved,true);loader.dispose();
});
function surface(){const listeners=new Map();return {visibilityState:'visible',on(n,f){if(!listeners.has(n))listeners.set(n,new Set());listeners.get(n).add(f);},off(n,f){listeners.get(n)?.delete(f);},addEventListener(n,f){this.on(n,f);},removeEventListener(n,f){this.off(n,f);},emit(n,v){for(const f of listeners.get(n)||[])f(v);},count(){return [...listeners.values()].reduce((n,s)=>n+s.size,0);}};}
test('only this thread refreshes, aliases coalesce and exact subscriptions are removed',()=>{
 const socket=surface(),win=surface(),doc=surface(),timers=new Map();let next=0,refreshes=0;
 const cleanup=subscribeSmsThread({socket,threadId:34,windowTarget:win,documentTarget:doc,refresh:()=>refreshes++,schedule:f=>{timers.set(++next,f);return next;},cancel:id=>timers.delete(id)});
 const flush=()=>{const callbacks=[...timers.values()];timers.clear();callbacks.forEach(f=>f());};
 socket.emit('sms:message:new',{threadId:99});socket.emit('sms:message:new',{threadId:'bad'});flush();assert.equal(refreshes,0);
 socket.emit('sms:message:new',{threadId:'34'});socket.emit('sms_message_new',{message:{threadId:34}});flush();assert.equal(refreshes,1);
 socket.emit('connect');win.emit('online');win.emit('focus');flush();assert.equal(refreshes,2);
 doc.visibilityState='hidden';doc.emit('visibilitychange');flush();assert.equal(refreshes,2);
 doc.visibilityState='visible';doc.emit('visibilitychange');flush();assert.equal(refreshes,3);
 socket.emit('sms:message:new',{threadId:34});cleanup();flush();assert.equal(refreshes,3);
 assert.equal(socket.count()+win.count()+doc.count(),0);
});
test('active layout uses scoped loader, media renderer and sidebar refresh',async()=>{
 const layout=await source('client/src/pages/SmsLayout.jsx');const media=await source('client/src/components/sms/SmsMessageMedia.jsx');
 assert.match(layout,/createSmsThreadLoader\(/);assert.match(layout,/subscribeSmsThread\(/);
 assert.match(layout,/loadedScope !== scopeKey/);assert.match(layout,/sidebar:reload-rooms/);
 assert.match(layout,/<SmsMessageMedia/);assert.doesNotMatch(layout,/<img[\s\S]{0,150}alt="MMS"/);
 assert.match(media,/responseType: 'blob'/);assert.match(media,/URL.revokeObjectURL/);
 assert.match(media,/<audio[^>]+controls/);assert.match(media,/audio\[data-sms-audio\]/);
});
