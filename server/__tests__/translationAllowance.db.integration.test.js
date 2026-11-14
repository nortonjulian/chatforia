/** @jest-environment node */
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { assertTestDatabaseSelected } from './helpers/testDatabase.js';

assertTestDatabaseSelected();
process.env.TRANSLATION_CACHE_TTL_SECONDS = '60';
const provider = jest.fn();
await jest.unstable_mockModule('../services/translation/googleTranslate.js', () => ({ translateText: provider }));
const { default: prisma } = await import('../utils/prismaClient.js');
const { maybeTranslateForTarget } = await import('../services/translation/translateMessage.js');
const { withTranslationAllowance } = await import('../services/translation/translationUsageService.js');
const { getMonthKey } = await import('../services/planUsageService.js');
let user;
beforeAll(async () => {
 user = await prisma.user.create({ data: { username: `translation_test_${randomUUID()}`, passwordHash: 'test-only', plan: 'FREE' } });
});
beforeEach(async () => {
 provider.mockReset().mockImplementation(async text => ({ translated: `es:${text}`, detectedSourceLanguage: 'en', provider: 'google' }));
 await prisma.planUsage.upsert({where:{ userId_monthKey:{userId:user.id,monthKey:getMonthKey()} },create:{userId:user.id,monthKey:getMonthKey()},update:{translationChars:0}});
});
afterAll(async () => { if(user) await prisma.user.delete({where:{id:user.id}}); await prisma.$disconnect(); });
const usage = () => prisma.planUsage.findUnique({where:{userId_monthKey:{userId:user.id,monthKey:getMonthKey()}}});
const call = text => maybeTranslateForTarget(text, null, 'es', {
 runBillable: operation => withTranslationAllowance({userId:user.id, plan:'FREE', amount:Array.from(text).length, operation, shouldBillResult:r=>r.provider==='google'}),
});
test('concurrent reservations cannot overspend the remaining allowance', async () => {
 await prisma.planUsage.update({where:{userId_monthKey:{userId:user.id,monthKey:getMonthKey()}},data:{translationChars:4995}});
 const results = await Promise.allSettled(Array.from({length:12},(_,i)=>call(`msg${String(i).padStart(2,'0')}`)));
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 expect(results.filter(r=>r.status==='rejected').every(r=>r.reason.code==='PLAN_ALLOWANCE_EXCEEDED')).toBe(true);
 expect((await usage()).translationChars).toBe(5000);
 expect(provider).toHaveBeenCalledTimes(1);
});
test('cached results remain available after the real database allowance is exhausted', async () => {
 await call('cache-db');
 await prisma.planUsage.update({where:{userId_monthKey:{userId:user.id,monthKey:getMonthKey()}},data:{translationChars:5000}});
 expect((await call('cache-db')).provider).toBe('cache');
 expect((await usage()).translationChars).toBe(5000);
 expect(provider).toHaveBeenCalledTimes(1);
});
test('a provider failure refunds only its reservation and permits a retry', async () => {
 provider.mockRejectedValueOnce(new Error('fixture failure'));
 await expect(call('retry-db')).rejects.toThrow('fixture failure');
 expect((await usage()).translationChars).toBe(0);
 await call('retry-db');
 expect((await usage()).translationChars).toBe(8);
});

test('shared AI actions remain atomic under competing requests', async () => {
 const { withRiaAllowance } = await import('../services/aiUsageService.js');
 await prisma.planUsage.update({where:{userId_monthKey:{userId:user.id,monthKey:getMonthKey()}},data:{riaActions:19}});
 const paid = jest.fn(async()=> 'ok');
 const results = await Promise.allSettled(Array.from({length:10},()=>withRiaAllowance({id:user.id,plan:'FREE'},paid)));
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 expect(paid).toHaveBeenCalledTimes(1);
 expect((await usage()).riaActions).toBe(20);
});

test('measured transcription reservations cannot exceed the Premium budget concurrently', async () => {
 const { createVoiceNoteHandlers } = await import('../services/voiceNoteTranscription.js');
 const now = new Date();
 await prisma.sTTUsage.upsert({where:{userId_monthKey:{userId:user.id,monthKey:getMonthKey(now)}},create:{userId:user.id,monthKey:getMonthKey(now),seconds:7110},update:{seconds:7110}});
 const paid = jest.fn();
 const handlers = createVoiceNoteHandlers({
  db:{
   sTTUsage:prisma.sTTUsage,
   message:{findUnique:async({where})=>({id:where.id,chatRoomId:1,createdAt:now,attachments:[{kind:'AUDIO',url:'fixture-audio',durationSec:1}]})},
   participant:{findFirst:async()=>({id:1})},
   user:{findUnique:async()=>({id:user.id,a11yVoiceNoteSTT:true,a11yStoreTranscripts:false,preferredLanguage:'en-US'})},
  },
  hasPremiumAccess:()=>true,config:{PREMIUM_STT_MIN_PER_MONTH:120},now:()=>now,
  transcribe:async(_url,_language,{beforeTranscribe})=>{await beforeTranscribe(90);paid();return {text:'fixture'};},
 });
 const response=()=>({statusCode:200,status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;},set(){}});
 const first=response(),second=response();
 await Promise.all([handlers.post({params:{messageId:'1'},user:{id:user.id},body:{}},first),handlers.post({params:{messageId:'2'},user:{id:user.id},body:{}},second)]);
 expect([first.statusCode,second.statusCode].sort()).toEqual([200,402]);
 expect(paid).toHaveBeenCalledTimes(1);
 expect((await prisma.sTTUsage.findUnique({where:{userId_monthKey:{userId:user.id,monthKey:getMonthKey(now)}}})).seconds).toBe(7200);
});
