import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const root = new URL('../', import.meta.url);
const source = await readFile(new URL('server/utils/smsMediaFetch.js', root), 'utf8');
const twilioSource = await readFile(new URL('server/utils/twilioMediaProxy.js', root), 'utf8');
const routeSource = await readFile(new URL('server/routes/sms.js', root), 'utf8');
const boom = {};
for (const [name,status] of Object.entries({badRequest:400,forbidden:403,notFound:404,badGateway:502,badImplementation:500})) {
 boom[name] = message => Object.assign(new Error(message),{status});
}
async function fixture() {
 const requests=[]; const routes=[];
 const state={userId:7,ownerId:7,message:{id:20,threadId:9,mediaUrls:['https://media.example/files/a.m4a']}, fetched:0};
 const response=()=>({ok:true,headers:new Headers({'content-type':state.contentType??'audio/mp4'}),arrayBuffer:async()=>new TextEncoder().encode('audio').buffer});
 const context=vm.createContext({URL,Buffer,Headers,console,process:{env:{TWILIO_ACCOUNT_SID:'AC123',TWILIO_AUTH_TOKEN:'secret',R2_PUBLIC_BASE:'https://media.example/files'}},
  fetch:async (url,options={})=>{requests.push({url,options});return response();}});
 const synth = (exports) => new vm.SyntheticModule(Object.keys(exports),function(){for(const [k,v] of Object.entries(exports))this.setExport(k,v);},{context});
 const boomModule=synth({default:boom});
 const twilio=new vm.SourceTextModule(twilioSource,{context});
 const media=new vm.SourceTextModule(source,{context});
 await twilio.link(()=>boomModule);await twilio.evaluate();
 await media.link(spec=>spec==='@hapi/boom'?boomModule:twilio);await media.evaluate();
 const router={use(){}};
 for(const method of ['get','post','patch','delete','put'])router[method]=(path,...handlers)=>routes.push({method,path,handlers});
 const prisma={smsMessage:{findFirst:async()=>state.message},smsThread:{findFirst:async()=>state.ownerId===state.userId?{id:9}:null}};
 const auth=(req,_res,next)=>{if(!req.user?.id)throw Object.assign(new Error('unauthorized'),{status:401});return next();};
 const imports={
  express:synth({default:{Router:()=>router,json:()=>()=>{}}}),
  '@hapi/boom':boomModule,
  '../utils/prismaClient.js':synth({default:prisma}),
  '../middleware/auth.js':synth({requireAuth:auth}),
  '../utils/asyncHandler.js':synth({asyncHandler:fn=>fn}),
  '../utils/analyticsManager.js':synth({default:{capture(){}}}),
  '../utils/phone.js':synth({normalizeE164:x=>x,isE164:()=>true}),
  '../services/smsService.js':synth({}),
  '../utils/smsMediaFetch.js':media,
  '../services/badgeSync.js':synth({syncBadgeToUserDevices:async()=>{}}),
 };
 const route=new vm.SourceTextModule(routeSource,{context});
 await route.link(spec=>{assert.ok(imports[spec],spec);return imports[spec];});await route.evaluate();
 const handler=routes.find(r=>r.method==='get'&&r.path==='/media/:messageId/:idx');
 async function request({user=7,messageId='20',idx='0'}={}) {
  state.userId=user;
  const req={user:user?{id:user}:null,params:{messageId,idx}};
  const result={headers:{},body:null};
  const res={setHeader(k,v){result.headers[k]=v;},status(n){result.status=n;return this;},send(b){result.body=b;return result;}};
  let i=0;const next=()=>handler.handlers[i++]?.(req,res,next);
  await next();return result;
 }
 return {media:media.namespace,requests,state,context,request};
}

test('stored audio fetch is anonymous, constrained to configured origin/path, with redirects disabled',async()=>{
 const f=await fixture();await f.media.fetchSMSMedia('https://media.example/files/a.m4a');
 assert.equal(f.requests.length,1);assert.equal(f.requests[0].options.headers,undefined);assert.equal(f.requests[0].options.redirect,'error');
});
test('Twilio account media retains authenticated retrieval',async()=>{
 const f=await fixture();await f.media.fetchSMSMedia('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages/SM1/Media/ME1');
 assert.equal(f.requests[0].options.headers.Authorization,'Basic '+Buffer.from('AC123:secret').toString('base64'));
});
for(const url of ['http://media.example/files/a.m4a','https://evil.example/a.m4a','https://api.twilio.com:8443/2010-04-01/Accounts/AC123/Messages/SM1/Media/ME1','https://media.example/other/a.m4a','https://media.example.evil/files/a.m4a','https://u:p@media.example/files/a.m4a','https://media.example/files/a.m4a#x','https://api.twilio.com/2010-04-01/Accounts/AC999/Messages/SM1/Media/ME1','https://api.twilio.com.evil/2010-04-01/Accounts/AC123/Messages/SM1/Media/ME1','file:///tmp/a','not-url']){
 test('rejects untrusted media without any fetch: '+url,async()=>{const f=await fixture();await assert.rejects(f.media.fetchSMSMedia(url));assert.equal(f.requests.length,0);});
}
test('missing storage configuration fails closed; Twilio credentials are never sent to storage',async()=>{
 const f=await fixture();delete f.context.process.env.R2_PUBLIC_BASE;
 await assert.rejects(f.media.fetchSMSMedia('https://media.example/files/a.m4a'));assert.equal(f.requests.length,0);
});
test('actual authorized route returns audio bytes and type for a stored attachment',async()=>{
 const f=await fixture();const r=await f.request();assert.equal(r.status,200);assert.equal(r.headers['Content-Type'],'audio/mp4');assert.equal(r.body.toString(),'audio');assert.equal(f.requests.length,1);
});
test('actual route supports object-shaped inbound audio, without treating it as [object Object]',async()=>{
 const f=await fixture();f.state.message.mediaUrls=[{url:'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages/SM1/Media/ME1',contentType:'audio/mp4'}];await f.request();assert.equal(f.requests.length,1);
});
test('nonowner and signed-out playback cannot trigger upstream fetch',async()=>{
 const f=await fixture();f.state.ownerId=8;await assert.rejects(f.request(),{status:404});assert.equal(f.requests.length,0);
 await assert.rejects(f.request({user:null}),{status:401});assert.equal(f.requests.length,0);
});
test('deleted message and absent attachment cannot fetch or disclose bytes',async()=>{
 const f=await fixture();f.state.message=null;await assert.rejects(f.request(),{status:404});assert.equal(f.requests.length,0);
 f.state.message={threadId:9,mediaUrls:[]};await assert.rejects(f.request(),{status:404});assert.equal(f.requests.length,0);
});
test('actual route rejects malformed media indices',async()=>{const f=await fixture();await assert.rejects(f.request({idx:'-1'}),{status:400});assert.equal(f.requests.length,0);});
test('actual route keeps ownership validation before media retrieval',async()=>{
 assert.ok(routeSource.indexOf('userId: Number(req.user.id)')<routeSource.indexOf('await fetchSMSMedia(url)'));
 assert.ok(routeSource.includes("import { fetchSMSMedia } from '../utils/smsMediaFetch.js'"));
});

test('storage fetch failure cannot be returned as audio success',async()=>{const f=await fixture();f.context.fetch=async()=>({ok:false});await assert.rejects(f.request(),{status:502});});

test('existing stored images still use the same authorized route and retain their content type',async()=>{const f=await fixture();f.state.contentType='image/jpeg';f.state.message.mediaUrls=['https://media.example/files/photo.jpg'];const r=await f.request();assert.equal(r.status,200);assert.equal(r.headers['Content-Type'],'image/jpeg');assert.equal(f.requests[0].options.headers,undefined);});
